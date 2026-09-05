import httpStatus from "http-status";
import {
	PaymentGateway,
	PaymentPurpose,
} from "../../../../generated/prisma/enums";
import config from "../../../config";
import { AppError } from "../../../utils/AppError";
import { getStripe } from "../../stripe";
import { ProviderAmbiguousError } from "../types";
import type {
	InitiateInput,
	InitiateResult,
	PaymentGatewayAdapter,
	RefundInput,
	VerifyInput,
	VerifyResult,
} from "../types";

// Stripe adapter (Prisma Press pattern, test mode, international payments).
// initiate = Checkout Session (mode: "payment", inline price_data); the
// signed webhook (`constructEvent`) is the trust anchor that alone may settle
// a payment. The BDT amount is converted to STRIPE_CURRENCY via the
// STRIPE_BDT_TO_BASE demo rate for the CHARGE only - settlement (I-G2)
// always verifies the event's actual `amount_total` in minor units, never
// our conversion.

// Full-refund helper mapped into the termination saga's reservation pattern.
// Definitive Stripe rejections throw AppError (retryable, reservation is
// released by the saga); undeterminable or not-yet-final outcomes throw
// ProviderAmbiguousError (kept REFUND_PENDING for admin reconciliation).
export const refundStripePayment = async ({
	sessionId,
	paymentIntent,
	amount,
	reason,
}: {
	sessionId: string;
	paymentIntent?: string;
	amount: string;
	reason: string;
}) => {
	try {
		// the charge reference: the session's payment intent, falling back to
		// the one the settle path recorded from the verified webhook event
		const session = await getStripe().checkout.sessions.retrieve(sessionId);
		const paymentIntentId =
			(typeof session.payment_intent === "string" && session.payment_intent) ||
			paymentIntent;

		if (!paymentIntentId) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"Stripe session has no payment intent to refund",
			);
		}

		const refund = await getStripe().refunds.create({
			payment_intent: paymentIntentId,
			metadata: { reason, ledgerAmountBdt: amount },
		});

		if (refund.status === "failed" || refund.status === "canceled") {
			throw new AppError(httpStatus.BAD_GATEWAY, "Stripe rejected the refund");
		}

		// pending/processing: the money has not definitively left Stripe yet
		if (refund.status !== "succeeded") {
			throw new ProviderAmbiguousError(
				"Stripe refund is not final yet (pending)",
			);
		}

		return refund;
	} catch (error) {
		if (error instanceof AppError || error instanceof ProviderAmbiguousError) {
			throw error;
		}

		// timeout / network failure / unparseable response: the request may
		// still have reached Stripe, so the outcome is unknown
		console.error("Stripe refund outcome unknown:", error);
		throw new ProviderAmbiguousError(
			"Stripe refund outcome could not be determined",
			{ cause: error },
		);
	}
};

export const stripeAdapter: PaymentGatewayAdapter = {
	gateway: PaymentGateway.STRIPE,

	isEnabled: () => Boolean(config.stripe_secret_key),

	initiate: async (input: InitiateInput): Promise<InitiateResult> => {
		// BDT ledger amount -> charge currency via the demo rate
		// (STRIPE_BDT_TO_BASE = BDT per one unit of the base currency, i.e.
		// 120 BDT ~ 1 USD): 3000 BDT / 120 = 25 USD -> unit_amount 2500
		// cents. The snapshot stores exactly what Stripe will report back in
		// `amount_total`, so I-G2 never depends on the conversion itself.
		const baseAmount = Math.round(
			Number(input.amount) / Number(config.stripe_bdt_to_base),
		);
		const unitAmount = Math.max(baseAmount, 1) * 100;

		// the payer lands back on the dashboard page matching the subject
		const dashboardPath =
			input.purpose === PaymentPurpose.DEPOSIT
				? "my-applications"
				: "my-invoices";

		try {
			const session = await getStripe().checkout.sessions.create({
				mode: "payment",
				line_items: [
					{
						quantity: 1,
						price_data: {
							currency: config.stripe_currency,
							unit_amount: unitAmount,
							product_data: {
								name: "Housing & Roommate",
								description: input.description.slice(0, 200),
							},
						},
					},
				],
				customer_email: input.payerEmail,
				success_url: `${config.frontend_url}/dashboard/${dashboardPath}?status=success`,
				cancel_url: `${config.frontend_url}/dashboard/${dashboardPath}?status=cancel`,
				metadata: {
					paymentId: input.merchantInvoiceNumber,
					purpose: input.purpose,
				},
			});

			return {
				redirectUrl: session.url as string,
				providerPaymentId: session.id,
				chargeCurrency: config.stripe_currency,
				chargeAmountMinorUnits: unitAmount,
				raw: session,
			};
		} catch (error: any) {
			console.log("Stripe checkout session error:", error);

			throw new AppError(
				httpStatus.BAD_GATEWAY,
				error?.message || "Failed to create Stripe checkout session",
			);
		}
	},

	verifyAndSettle: async ({
		providerPayload,
	}: VerifyInput): Promise<VerifyResult> => {
		// providerPayload = the verified `checkout.session.completed` event's
		// session object (the webhook handler already validated the
		// signature via constructEvent - that is the trust anchor)
		const session = providerPayload as {
			id?: string;
			payment_intent?: string;
			amount_total?: number;
			payment_status?: string;
			created?: number;
		};

		if (session.payment_status !== "paid") {
			return {
				outcome: "FAILED",
				executedResult: session as any,
				reportedAmountMinorUnits: null,
			};
		}

		return {
			outcome: "SETTLED",
			// map the session onto the provider-neutral fields settle.ts
			// persists (payment_intent -> trxID, session.created -> paidAt)
			executedResult: {
				...session,
				trxID: session.payment_intent ?? session.id,
				paymentExecuteTime: session.created
					? new Date(session.created * 1000).toISOString()
					: new Date().toISOString(),
			},
			// Stripe already reports minor units - no normalization needed
			reportedAmountMinorUnits:
				typeof session.amount_total === "number" ? session.amount_total : null,
		};
	},

	refund: async ({ payment, amount, reason }: RefundInput) => {
		if (!payment.bKashPaymentId) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"Payment has no Stripe session reference",
			);
		}

		const refund = await refundStripePayment({
			sessionId: payment.bKashPaymentId,
			paymentIntent: payment.bKashTrxId ?? undefined,
			amount: amount.toString(),
			reason,
		});

		return {
			providerRefundId: refund.id,
			raw: refund,
		};
	},
};
