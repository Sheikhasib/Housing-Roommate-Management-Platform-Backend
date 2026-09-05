import PDFDocument from "pdfkit";
import httpStatus from "http-status";
import type Stripe from "stripe";
import {
	NotificationType,
	PaymentGateway,
	PaymentPurpose,
	PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import type { PaymentWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { getStripe } from "../../lib/stripe";
import { getAdapter, listEnabledGateways } from "../../lib/payments/registry";
import {
	markCancelled,
	markFailed,
	settleFromProvider,
} from "../../lib/payments/settle";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";

// Build a PDF receipt buffer (invoice style) for an email attachment.
const buildReceiptPdf = async (
	lines: { label: string; value: string }[],
): Promise<Buffer> => {
	const pdfDocument = new PDFDocument({ margin: 50 });
	const pdfChunks: Buffer[] = [];

	pdfDocument.on("data", (chunk: Buffer) => pdfChunks.push(chunk));

	const pdfReadyPromise = new Promise<Buffer>((resolve) => {
		pdfDocument.on("end", () => resolve(Buffer.concat(pdfChunks)));
	});

	pdfDocument.fontSize(20).text("Housing & Roommate", { align: "center" });
	pdfDocument.fontSize(13).text("Payment Receipt", { align: "center" });
	pdfDocument.moveDown(2);

	lines.forEach((line) => {
		pdfDocument.fontSize(11).text(`${line.label}: ${line.value}`);
	});

	pdfDocument.end();
	return pdfReadyPromise;
};

// Post-settle side effects shared by every gateway's confirm path. Everything
// is already committed at this point: failures must not 500 the caller's
// response (and skip one another).
const runDepositSettleSideEffects = async (
	result: any,
	executedResult: Record<string, unknown>,
) => {
	if (!result || result.alreadyPaid) {
		return;
	}

	const { application, lease, payment: paymentRow } = result;
	const { trxID, paymentExecuteTime } = executedResult as {
		trxID?: string;
		paymentExecuteTime?: string;
	};

	try {
		const receiptPdf = await buildReceiptPdf([
			{ label: "Receipt Type", value: "Booking Deposit" },
			{ label: "Tenant Name", value: application.tenantProfile.name },
			{ label: "Tenant Email", value: application.tenantProfile.email },
			{ label: "Room", value: application.room.name },
			{ label: "Lease Start", value: lease.startDate.toDateString() },
			{ label: "Lease End", value: lease.endDate.toDateString() },
			{ label: "Amount Paid", value: `${paymentRow.amount} BDT` },
			{ label: "Transaction Id", value: trxID },
			{ label: "Paid At", value: paymentExecuteTime },
		]);

		await sendTemplateEmail({
			to: application.tenantProfile.email,
			subject: "Your Booking Deposit Receipt - Housing & Roommate",
			template: "payment-receipt",
			data: { name: application.tenantProfile.name },
			attachments: [{ filename: "deposit-receipt.pdf", content: receiptPdf }],
		});
	} catch (error) {
		console.log("Deposit receipt email failed:", error);
	}

	try {
		await createNotification({
			userId: application.tenantProfile.userId,
			type: NotificationType.PAYMENT,
			title: "Deposit paid ✅",
			message: `Your booking deposit for "${application.room.name}" was received. Your lease is now active.`,
			data: { leaseId: lease.id },
		});
	} catch (error) {
		console.log("Deposit notification failed:", error);
	}
};

const runInvoiceSettleSideEffects = async (result: any) => {
	if (!result) {
		return;
	}

	try {
		await createNotification({
			userId: result.invoice.lease.tenantProfile.userId,
			type: NotificationType.PAYMENT,
			title: "Invoice paid 💰",
			message: `Your ${result.invoice.type.toLowerCase()} invoice of ৳${result.invoice.amount} was paid successfully.`,
			data: { invoiceId: result.invoice.id },
		});
	} catch (error) {
		console.log("Invoice-paid notification failed:", error);
	}
};

// The bKash callback URL. bKash redirects the user here after they finish
// (success / failure / cancel) on the payment page. The flow resolves through
// the gateway adapter + shared settle helpers with identical outcomes:
// adapters own the provider HTTP, settle.ts owns the money state.
const paymentCallback = async (query: Record<string, any>) => {
	const paymentID = query.paymentID;
	const status = query.status;

	if (!paymentID || !status) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid bKash callback query");
	}

	const isSuccess = status === "success";

	// find the local payment row by the gateway payment id (or invoice
	// number), scoped to bKash rows so a bKash redirect can never resolve
	// another gateway's session
	const payment = await prisma.payment.findFirst({
		where: {
			gateway: PaymentGateway.BKASH,
			OR: [
				{ bKashPaymentId: paymentID },
				{ merchantInvoiceNumber: query.merchantInvoiceNumber },
			],
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	const isDeposit = payment.purpose === PaymentPurpose.DEPOSIT;

	if (isSuccess) {
		const successRedirect = isDeposit
			? `${config.frontend_url}/dashboard/my-applications?status=success`
			: `${config.frontend_url}/dashboard/my-invoices?status=success`;

		// replayed redirect for an already-settled payment: nothing to query
		// or settle (I-G3 no-op)
		if (payment.status === PaymentStatus.PAID) {
			return { redirectUrl: successRedirect };
		}

		// execute the payment to read its final state from the gateway. On a
		// cancel/failure the payment was never executed, so we skip this call
		// and only confirm the local FAILED/CANCELLED state below.
		const verification = await getAdapter(PaymentGateway.BKASH).verifyAndSettle(
			{ payment, providerPayload: query },
		);

		if (verification.outcome !== "SETTLED") {
			// the session never completed at the gateway - no money moved
			await markFailed(payment.id, verification.executedResult);

			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=failure`,
			};
		}

		const settleResult = await settleFromProvider({
			paymentId: payment.id,
			executedResult: verification.executedResult,
			reportedAmountMinorUnits: verification.reportedAmountMinorUnits,
			gateway: PaymentGateway.BKASH,
		});

		// I-G2 trip: the charged amount does not match the initiation
		// snapshot - held PROCESSING for admin review, never auto-settled
		if (settleResult.outcome === "AMOUNT_MISMATCH") {
			return {
				redirectUrl: `${config.frontend_url}?payment=error`,
			};
		}

		if (isDeposit) {
			await runDepositSettleSideEffects(
				settleResult.result,
				verification.executedResult,
			);

			return { redirectUrl: successRedirect };
		}

		// RENT / UTILITY invoice payment
		await runInvoiceSettleSideEffects(settleResult.result);

		return { redirectUrl: successRedirect };
	}

	if (status === "failure" || status === "cancel") {
		// no gateway execution happened - store the raw callback payload.
		// Conditional writes (I-G4): a late failure/cancel can never clobber
		// a payment that has meanwhile settled.
		if (status === "failure") {
			await markFailed(payment.id, query);
		} else {
			await markCancelled(payment.id, query);
		}

		return {
			redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=${status}`,
		};
	}

	// unknown bKash status
	return {
		redirectUrl: `${config.frontend_url}?payment=error`,
	};
};

// SSLCommerz notification handler: /confirm receives the browser POST after
// the hosted page (success / fail / cancel), /ipn receives the server-to-
// server notification - both resolve through here. Success runs the
// server-side validator (the trust anchor) and settles through the shared
// path; fail/cancel only ever conditionally downgrade a still-PROCESSING
// row (I-G4). Returns a structured outcome so the callers can redirect
// (/confirm) or ack with JSON (/ipn).
const confirmSslcommerzPayment = async (
	query: Record<string, any>,
	payload: Record<string, any>,
) => {
	const paymentId = query.paymentId; // subject key (applicationId/invoiceId)
	const tranId = query.tranId;

	if (!paymentId || !tranId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Invalid SSLCommerz callback query",
		);
	}

	const status = query.status as string | undefined;

	// find the local payment row by the gateway transaction id (or the
	// subject key), scoped to SSLCommerz rows so an SSLCommerz notification
	// can never resolve another gateway's session
	const payment = await prisma.payment.findFirst({
		where: {
			gateway: PaymentGateway.SSLCOMMERZ,
			OR: [{ bKashPaymentId: tranId }, { merchantInvoiceNumber: paymentId }],
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	const isDeposit = payment.purpose === PaymentPurpose.DEPOSIT;
	const successRedirect = isDeposit
		? `${config.frontend_url}/dashboard/my-applications?status=success`
		: `${config.frontend_url}/dashboard/my-invoices?status=success`;

	// idempotent: an already-settled payment is a no-op (SSLCommerz can call
	// more than once)
	if (payment.status === PaymentStatus.PAID) {
		return {
			paymentStatus: PaymentStatus.PAID,
			redirectUrl: successRedirect,
			alreadyProcessed: true,
		};
	}

	if (status === "fail" || status === "cancel") {
		// the session never completed at the gateway - no money moved. Store
		// the raw notification payload (I-G4 conditional writes).
		if (status === "fail") {
			await markFailed(payment.id, payload);
		} else {
			await markCancelled(payment.id, payload);
		}

		return {
			paymentStatus:
				status === "fail" ? PaymentStatus.FAILED : PaymentStatus.CANCELLED,
			redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=${status}`,
			alreadyProcessed: false,
		};
	}

	// success (or IPN): the validator decides - only VALID / VALIDATED ever
	// settles (I-G1)
	const verification = await getAdapter(
		PaymentGateway.SSLCOMMERZ,
	).verifyAndSettle({ payment, providerPayload: payload });

	if (verification.outcome !== "SETTLED") {
		await markFailed(payment.id, verification.executedResult);

		return {
			paymentStatus: PaymentStatus.FAILED,
			redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=failure`,
			alreadyProcessed: false,
		};
	}

	const settleResult = await settleFromProvider({
		paymentId: payment.id,
		executedResult: verification.executedResult,
		reportedAmountMinorUnits: verification.reportedAmountMinorUnits,
		gateway: PaymentGateway.SSLCOMMERZ,
	});

	// I-G2 trip: the charged amount does not match the initiation snapshot -
	// held PROCESSING for admin review, never auto-settled
	if (settleResult.outcome === "AMOUNT_MISMATCH") {
		return {
			paymentStatus: PaymentStatus.PROCESSING,
			redirectUrl: `${config.frontend_url}?payment=error`,
			alreadyProcessed: false,
		};
	}

	if (isDeposit) {
		await runDepositSettleSideEffects(
			settleResult.result,
			verification.executedResult,
		);
	} else {
		await runInvoiceSettleSideEffects(settleResult.result);
	}

	return {
		paymentStatus: PaymentStatus.PAID,
		redirectUrl: successRedirect,
		alreadyProcessed: false,
	};
};

// Enabled payment gateways (public - powers the frontend payment buttons)
const getGateways = () => {
	return { gateways: listEnabledGateways() };
};

// TENANT: payments I made
const getMyPayments = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: PaymentWhereInput[] = [
		{
			OR: [
				{ application: { tenantProfileId: tenantProfile.id } },
				{ invoice: { lease: { tenantProfileId: tenantProfile.id } } },
			],
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.purpose) {
		andConditions.push({ purpose: query.purpose });
	}

	const payments = await prisma.payment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			application: {
				select: {
					id: true,
					status: true,
					room: { select: { id: true, name: true } },
				},
			},
			invoice: {
				select: { id: true, type: true, amount: true, dueDate: true },
			},
		},
	});

	const total = await prisma.payment.count({ where: { AND: andConditions } });

	return {
		data: payments,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// ADMIN: all payments
const getAllPayments = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: PaymentWhereInput[] = [];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.purpose) {
		andConditions.push({ purpose: query.purpose });
	}

	const payments = await prisma.payment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			application: {
				select: {
					id: true,
					tenantProfile: { select: { id: true, name: true, email: true } },
				},
			},
			invoice: {
				select: {
					id: true,
					type: true,
					lease: {
						select: {
							tenantProfile: { select: { id: true, name: true, email: true } },
						},
					},
				},
			},
		},
	});

	const total = await prisma.payment.count({ where: { AND: andConditions } });

	return {
		data: payments,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Single payment detail (participant/admin)
const getSinglePayment = async (paymentId: string, user: RequestUser) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		include: {
			application: {
				include: {
					tenantProfile: { select: { id: true, name: true, email: true } },
				},
			},
			invoice: {
				include: {
					lease: {
						include: {
							tenantProfile: { select: { id: true, name: true, email: true } },
						},
					},
				},
			},
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	const tenantProfileId = payment.application?.tenantProfileId
		? payment.application.tenantProfileId
		: payment.invoice?.lease.tenantProfileId;

	const payerProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	const isPayer = payerProfile && payerProfile.id === tenantProfileId;
	const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

	if (!isPayer && !isAdmin) {
		throw new AppError(httpStatus.FORBIDDEN, "You cannot view this payment");
	}

	return payment;
};

// Stripe webhook (Prisma Press pattern). The signature verification
// (`constructEvent` with the raw body) IS the trust anchor; only
// `checkout.session.completed` (payment_status "paid") may settle and only
// `checkout.session.expired` may cancel (while still PROCESSING - I-G4).
// Everything else is acked without state change. Idempotency: the settle
// path no-ops on PAID rows and markCancelled is a conditional write, so
// provider retries are strict no-ops; the event id rides along in the raw
// payload for diagnostics.
const stripeWebhook = async (payload: Buffer, signature: string) => {
	let event: Stripe.Event;
	try {
		event = getStripe().webhooks.constructEvent(
			payload,
			signature,
			config.stripe_webhook_secret,
		);
	} catch (error: any) {
		// invalid/missing signature: never process, never settle
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Stripe webhook signature verification failed: ${error?.message ?? "unknown error"}`,
		);
	}

	if (
		event.type !== "checkout.session.completed" &&
		event.type !== "checkout.session.expired"
	) {
		// allowlisted set only; unknown events are acked without state change
		return { handled: false, type: event.type };
	}

	const session = event.data.object as {
		id: string;
		payment_intent: string | null;
		amount_total: number | null;
		payment_status?: string;
		created?: number;
	};

	// find the local row by the gateway-scoped provider ref (session id)
	const payment = await prisma.payment.findFirst({
		where: { gateway: PaymentGateway.STRIPE, bKashPaymentId: session.id },
	});

	if (!payment) {
		return { handled: false, type: event.type };
	}

	if (event.type === "checkout.session.expired") {
		// conditional write: only a still-PROCESSING row is cancelled
		await markCancelled(payment.id, {
			eventId: event.id,
			type: event.type,
			session,
		});

		return { handled: true, type: event.type, outcome: "CANCELLED" };
	}

	// checkout.session.completed - only a paid session settles (allowlist)
	if (session.payment_status !== "paid") {
		return { handled: false, type: event.type };
	}

	// replayed webhook for an already-settled payment: nothing to do (I-G3)
	if (payment.status === PaymentStatus.PAID) {
		return { handled: true, type: event.type, outcome: "ALREADY_SETTLED" };
	}

	// the adapter maps the session onto the provider-neutral fields; the
	// event id rides along inside the persisted raw payload
	const verification = await getAdapter(PaymentGateway.STRIPE).verifyAndSettle({
		payment,
		providerPayload: session,
	});

	const settleResult = await settleFromProvider({
		paymentId: payment.id,
		executedResult: { ...verification.executedResult, eventId: event.id },
		reportedAmountMinorUnits: verification.reportedAmountMinorUnits,
		gateway: PaymentGateway.STRIPE,
	});

	// mismatch stays PROCESSING + audited; ALREADY_SETTLED is a no-op
	if (settleResult.outcome !== "SETTLED") {
		return { handled: true, type: event.type, outcome: settleResult.outcome };
	}

	// side effects are the SHARED post-settle helpers (receipt PDF email +
	// notifications, fail-soft, post-commit) - identical to bKash/SSLCommerz
	if (payment.purpose === PaymentPurpose.DEPOSIT) {
		await runDepositSettleSideEffects(
			settleResult.result,
			verification.executedResult,
		);
	} else {
		await runInvoiceSettleSideEffects(settleResult.result);
	}

	return { handled: true, type: event.type, outcome: "SETTLED" };
};

export const PaymentServices = {
	paymentCallback,
	confirmSslcommerzPayment,
	stripeWebhook,
	getGateways,
	getMyPayments,
	getAllPayments,
	getSinglePayment,
};
