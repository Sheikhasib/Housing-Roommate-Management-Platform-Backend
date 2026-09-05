import axios from "axios";
import httpStatus from "http-status";
import { PaymentGateway } from "../../../../generated/prisma/enums";
import config from "../../../config";
import { AppError } from "../../../utils/AppError";
import type {
	InitiateInput,
	InitiateResult,
	PaymentGatewayAdapter,
	VerifyInput,
	VerifyResult,
} from "../types";

// SSLCommerz adapter (GearUp pattern, sandbox). initiate = form-urlencoded
// POST to the session endpoint returning a GatewayPageURL; verifyAndSettle =
// the server-side validator API called with the store credentials - the
// trust anchor that alone may confirm a payment (only VALID / VALIDATED
// verdicts ever settle). card_type is kept inside the raw payload (GearUp
// stores it as the payment `method`).

const SSLCOMMERZ_TIMEOUT_MS = 30_000;

export const sslcommerzAdapter: PaymentGatewayAdapter = {
	gateway: PaymentGateway.SSLCOMMERZ,

	isEnabled: () =>
		Boolean(config.ssl_commerz_store_id && config.ssl_commerz_store_passwd),

	initiate: async (input: InitiateInput): Promise<InitiateResult> => {
		const tranId = `TRNX_ID_${Date.now()}`;

		// paymentId below carries the subject key (applicationId or
		// invoiceId = merchantInvoiceNumber) used as the row-locating
		// fallback when /confirm or /ipn arrives
		const paymentData = {
			store_id: config.ssl_commerz_store_id,
			store_passwd: config.ssl_commerz_store_passwd,
			total_amount: input.amount,
			currency: "BDT",
			tran_id: tranId,
			success_url: `${config.backend_public_url}/api/v1/payment/confirm?paymentId=${input.merchantInvoiceNumber}&tranId=${tranId}&status=success`,
			fail_url: `${config.backend_public_url}/api/v1/payment/confirm?paymentId=${input.merchantInvoiceNumber}&tranId=${tranId}&status=fail`,
			cancel_url: `${config.backend_public_url}/api/v1/payment/confirm?paymentId=${input.merchantInvoiceNumber}&tranId=${tranId}&status=cancel`,
			ipn_url: `${config.backend_public_url}/api/v1/payment/ipn?paymentId=${input.merchantInvoiceNumber}&tranId=${tranId}`,
			cus_name: input.payerName || input.payerEmail,
			cus_email: input.payerEmail,
			cus_add1: "N/A",
			cus_add2: "N/A",
			cus_city: "N/A",
			cus_state: "N/A",
			cus_postcode: 1000,
			cus_country: "Bangladesh",
			cus_phone: "01711111111",
			cus_fax: "01711111111",
		};

		try {
			const response = await axios.post(
				config.sslcommerz_init_url,
				paymentData,
				{
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					timeout: SSLCOMMERZ_TIMEOUT_MS,
				},
			);

			const data = response.data;

			console.log({ sslcommerzInitResult: data });

			if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
				throw new AppError(
					httpStatus.BAD_GATEWAY,
					`Failed to initiate payment: ${data.failedreason || "unknown error"}`,
				);
			}

			return {
				redirectUrl: data.GatewayPageURL,
				providerPaymentId: tranId,
				chargeCurrency: "BDT",
				chargeAmountMinorUnits: Math.round(Number(input.amount) * 100),
				raw: data,
			};
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}

			console.log("SSLCommerz init error:", error?.response?.data || error);

			throw new AppError(
				httpStatus.BAD_GATEWAY,
				error?.response?.data?.failedreason ||
					error?.message ||
					"Failed to initiate payment",
			);
		}
	},

	verifyAndSettle: async ({
		providerPayload,
	}: VerifyInput): Promise<VerifyResult> => {
		const valId = providerPayload.val_id;

		// no val_id -> there is nothing to validate against the bank
		// (forged or failed notification): never settles
		if (typeof valId !== "string" || !valId) {
			return {
				outcome: "FAILED",
				executedResult: {
					status: "FORGED",
					gateway: "SSLCOMMERZ",
					payload: providerPayload,
				},
				reportedAmountMinorUnits: null,
			};
		}

		// the validator is the trust anchor: it answers with the definitive
		// transaction state for the val_id, authenticated by store creds
		const response = await axios.post(
			`${config.sslcommerz_validate_url}?val_id=${encodeURIComponent(valId)}&store_id=${config.ssl_commerz_store_id}&store_passwd=${config.ssl_commerz_store_passwd}&format=json`,
			{},
			{
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				timeout: SSLCOMMERZ_TIMEOUT_MS,
			},
		);

		const data = response.data;

		console.log({ sslcommerzValidationResult: data });

		if (data.status === "VALID" || data.status === "VALIDATED") {
			// map the validator payload onto the provider-neutral fields
			// settle.ts persists (bank_tran_id -> trxID, tran_date -> paidAt)
			const executedResult = {
				...data,
				trxID: data.bank_tran_id ?? data.tran_id,
				paymentExecuteTime: data.tran_date ?? new Date().toISOString(),
			};

			// SSLCommerz reports BDT in taka strings -> minor units (x100)
			const reportedAmount =
				typeof data.amount === "string" || typeof data.amount === "number"
					? Math.round(Number(data.amount) * 100)
					: null;

			return {
				outcome: "SETTLED",
				executedResult,
				reportedAmountMinorUnits: reportedAmount,
			};
		}

		return {
			outcome: "FAILED",
			executedResult: data,
			reportedAmountMinorUnits: null,
		};
	},
};
