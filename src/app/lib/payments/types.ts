import type {
	PaymentGateway,
	PaymentPurpose,
} from "../../../generated/prisma/enums";

// Gateway-neutral payment abstraction (master plan §2.1).
//
// Provider-neutral Payment columns (documented legacy names, deliberately NOT
// renamed to keep migrations additive-only):
//   bKashPaymentId -> providerPaymentId   (bKash paymentID / SSLCommerz tran_id / Stripe session id)
//   bKashTrxId     -> providerTrxId       (provider transaction id)
//   paidAt         -> providerPaidAt      (provider-reported payment time)
//   gatwayResponse -> raw provider payload (validation response / webhook event)
//   gateway        -> PaymentGateway enum

// The subset of a Payment row that adapters operate on (a full Prisma Payment
// row is structurally assignable to this).
export type PaymentRecord = {
	id: string;
	status: string;
	purpose: PaymentPurpose;
	gateway: PaymentGateway;
	merchantInvoiceNumber: string;
	bKashPaymentId: string | null;
	bKashTrxId: string | null;
	providerChargeAmount: number | null;
	providerChargeCurrency: string | null;
	applicationId: string | null;
	invoiceId: string | null;
};

export type InitiateInput = {
	merchantInvoiceNumber: string; // applicationId or invoiceId - THE subject key
	purpose: PaymentPurpose;
	amount: string; // BDT decimal string, e.g. "5000.00"
	description: string;
	payerEmail: string;
	payerName?: string;
};

export type InitiateResult = {
	redirectUrl: string; // browser target for the payer
	providerPaymentId: string; // gateway session/transaction id
	chargeCurrency: string; // currency the provider was asked to charge in
	chargeAmountMinorUnits: number; // minor-units snapshot for the I-G2 settle check
	raw: unknown;
};

// Normalized outcome of a provider-verified confirmation. settle.ts is the
// ONLY consumer that may turn SETTLED into money state.
export type VerifyOutcome =
	| "SETTLED"
	| "ALREADY_SETTLED"
	| "FAILED"
	| "CANCELLED"
	| "AMOUNT_MISMATCH";

export type VerifyInput = {
	payment: PaymentRecord;
	providerPayload: Record<string, unknown>;
};

export type VerifyResult = {
	outcome: VerifyOutcome;
	// provider confirmation payload (bKash execute result with trxID /
	// paymentExecuteTime / amount) - persisted as gatwayResponse on settle
	executedResult: Record<string, unknown>;
	// provider-reported charge normalized to minor units (bKash/SSLCommerz
	// taka strings x100; Stripe already minor units) - the I-G2 input
	reportedAmountMinorUnits: number | null;
};

export type RefundInput = {
	payment: PaymentRecord;
	amount: string; // BDT decimal string
	reason: string;
};

export interface PaymentGatewayAdapter {
	readonly gateway: PaymentGateway;
	isEnabled(): boolean;
	initiate(input: InitiateInput): Promise<InitiateResult>;
	verifyAndSettle(input: VerifyInput): Promise<VerifyResult>;
	refund?(input: RefundInput): Promise<{
		providerRefundId: string | null;
		raw: unknown;
	}>;
}

// A gateway call with no definitive answer (timeout, dropped connection).
// The request may still have been processed by the provider, so callers must
// reconcile instead of blindly retrying (refund-saga contract, shared with
// the bKash-specific BkashAmbiguousError).
export class ProviderAmbiguousError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "ProviderAmbiguousError";
	}
}
