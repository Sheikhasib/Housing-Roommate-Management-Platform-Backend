import httpStatus from "http-status";
import { PaymentGateway } from "../../../../generated/prisma/enums";
import {
	createBkashPayment,
	executeBkashPayment,
	refundBkashPayment,
} from "../../bKash";
import { AppError } from "../../../utils/AppError";
import type {
	InitiateInput,
	InitiateResult,
	PaymentGatewayAdapter,
	RefundInput,
	VerifyInput,
	VerifyResult,
} from "../types";

// bKash adapter (Tokenized Checkout). Thin wrapper around the existing,
// battle-tested bKash helpers: initiate maps to create, verifyAndSettle maps
// to the redirect callback's server-side execute (the execute result IS the
// provider-verified confirmation), refund maps to the refund helper. All
// gateway calls carry a 30s AbortSignal timeout (lib/bKash.ts).

export const bkashAdapter: PaymentGatewayAdapter = {
	gateway: PaymentGateway.BKASH,

	isEnabled: () => true,

	initiate: async (input: InitiateInput): Promise<InitiateResult> => {
		const result = await createBkashPayment({
			amount: input.amount,
			payerReference: input.payerEmail,
			merchantInvoiceNumber: input.merchantInvoiceNumber,
			callbackPath: "/payment/callback",
		});

		return {
			redirectUrl: result.bkashURL,
			providerPaymentId: result.paymentID,
			chargeCurrency: "BDT",
			chargeAmountMinorUnits: Math.round(Number(input.amount) * 100),
			raw: result,
		};
	},

	verifyAndSettle: async ({ payment }: VerifyInput): Promise<VerifyResult> => {
		const paymentID = payment.bKashPaymentId;

		if (!paymentID) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Payment has no bKash session reference",
			);
		}

		// the execute call is the trust anchor: bKash returns the definitive
		// transaction state for the session stored on the row
		const executedResult = await executeBkashPayment(paymentID);

		// bKash answers HTTP 200 with a business status code; only "0000"
		// (or the presence of a trxID) proves the session actually executed
		// and money moved (I-G1)
		const executed =
			executedResult.statusCode === "0000" || Boolean(executedResult.trxID);

		if (!executed) {
			return {
				outcome: "FAILED",
				executedResult,
				reportedAmountMinorUnits: null,
			};
		}

		// bKash reports BDT in taka strings -> normalize to minor units (x100)
		const reportedAmount =
			typeof executedResult.amount === "string" ||
			typeof executedResult.amount === "number"
				? Math.round(Number(executedResult.amount) * 100)
				: null;

		return {
			outcome: "SETTLED",
			executedResult,
			reportedAmountMinorUnits: reportedAmount,
		};
	},

	refund: async ({ payment, amount, reason }: RefundInput) => {
		const result = await refundBkashPayment({
			paymentID: payment.bKashPaymentId ?? undefined,
			trxID: payment.bKashTrxId ?? undefined,
			amount,
			reason,
			sku: payment.merchantInvoiceNumber,
		});

		return {
			providerRefundId: result.refundTrxID ?? null,
			raw: result,
		};
	},
};
