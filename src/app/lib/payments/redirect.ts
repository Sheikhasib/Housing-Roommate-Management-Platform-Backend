import config from "../../config";

type PaymentPurposeValue = "DEPOSIT" | "RENT" | "UTILITY";

export const frontendPaymentRedirect = (p: {
	outcome: "success" | "cancel";
	purpose?: PaymentPurposeValue;
	// merchantInvoiceNumber: application id (DEPOSIT) or invoice id (RENT, UTILITY)
	ref?: string;
	paymentId?: string;
	reason?: "failure" | "cancel" | "error";
}) => {
	const q = new URLSearchParams();

	if (p.purpose) {
		q.set("purpose", p.purpose);
	}

	if (p.ref) {
		q.set("ref", p.ref);
	}

	if (p.paymentId) {
		q.set("paymentId", p.paymentId);
	}

	if (p.reason) {
		q.set("reason", p.reason);
	}

	const qs = q.toString();

	return `${config.frontend_url}/payment/${p.outcome}${qs ? `?${qs}` : ""}`;
};

export const frontendPaymentRedirectFor = (
	payment: {
		id: string;
		purpose: PaymentPurposeValue;
		merchantInvoiceNumber: string;
	},
	outcome: "success" | "cancel",
	reason?: "failure" | "cancel" | "error",
) =>
	frontendPaymentRedirect({
		outcome,
		purpose: payment.purpose,
		ref: payment.merchantInvoiceNumber,
		paymentId: payment.id,
		reason,
	});
