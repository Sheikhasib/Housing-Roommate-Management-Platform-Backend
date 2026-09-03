import config from "../config";
import httpStatus from "http-status";
import { AppError } from "../utils/AppError";
import { redisClient } from "./redis";

// bKash Tokenized Checkout helpers.
// The gateway access token (and its refresh token) are cached in Redis to
// avoid hitting the grant endpoint on every single payment request.

const IdTokenKey = "bKash: idToken";
const RefreshTokenKey = "bKash: refreshToken";

export const getBkashIdToken = async () => {
	try {
		// bKash id token get from redis
		let bKashIdToken = await redisClient.get(IdTokenKey);
		// get bKash id token ttl from redis
		const bKashIdTokenTTL = await redisClient.ttl(IdTokenKey);

		// bKash refresh token get from redis
		const bKashRefreshToken = await redisClient.get(RefreshTokenKey);
		// get bKash refresh token ttl from redis
		const bKashRefreshTokenTTL = await redisClient.ttl(RefreshTokenKey);

		// if bKash id token not exist / expired in redis and bKash refresh token must exist in redis, then regenerate bKash id token from bKash refresh token
		//bKash id token remaining time is less than or equal 10 minutes
		//bKash refresh token remaining time is more than 10 minutes
		if (
			(!bKashIdToken || bKashIdTokenTTL <= 600) &&
			bKashRefreshToken &&
			bKashRefreshTokenTTL > 600
		) {
			const refreshTokenResponse = await fetch(
				`${config.bkash_base_url}/tokenized/checkout/token/refresh`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
						username: config.bkash_username,
						password: config.bkash_password,
					},
					body: JSON.stringify({
						app_key: config.bkash_app_key,
						app_secret: config.bkash_app_secret,
						refresh_token: bKashRefreshToken,
					}),
				},
			);

			// if bKash refresh token response is not ok then throw error
			if (!refreshTokenResponse.ok) {
				throw new AppError(
					httpStatus.BAD_GATEWAY,
					"Failed to refresh bKash id token",
				);
			}

			// refresh bKash id token
			const bKashRefreshTokenResult = await refreshTokenResponse.json();

			// bKash id token set from bKash refresh token
			bKashIdToken = bKashRefreshTokenResult.id_token as string;

			// bKash id token set in redis with 1 hour ttl
			await redisClient.set(IdTokenKey, bKashIdToken, {
				expiration: {
					type: "EX",
					value: 60 * 60, // 1 hour
				},
			});

			return bKashIdToken;
		}

		// if bKash id token TTL is greater than 10 minutes then return bKash id token
		if (bKashIdTokenTTL > 600) {
			return bKashIdToken;
		}

		const res = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/token/grant`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					username: config.bkash_username,
					password: config.bkash_password,
				},
				body: JSON.stringify({
					app_key: config.bkash_app_key,
					app_secret: config.bkash_app_secret,
				}),
			},
		);

		if (!res.ok) {
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				"Failed to get bKash ID Token",
			);
		}

		const result = await res.json();

		// bKash id token set
		await redisClient.set(IdTokenKey, result.id_token, {
			expiration: {
				type: "EX",
				value: 60 * 60, // 1 hour
			},
		});

		// bKash refresh token set
		await redisClient.set(RefreshTokenKey, result.refresh_token, {
			expiration: {
				type: "EX",
				value: 60 * 60 * 24 * 28, // 28 days
			},
		});

		bKashIdToken = result.id_token;

		return bKashIdToken;
	} catch (error: any) {
		console.error("bKash token error:", error, error.cause);
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			error.cause?.message || error.message,
		);
	}
};

// Create a bKash checkout session for a payment. `callbackPath` is appended to
// BKASH_CALLBACK_URL (e.g. "/payment/callback") and is hit by the gateway when
// the customer finishes (success / failure / cancel) on the bKash page.
export const createBkashPayment = async ({
	amount,
	payerReference,
	merchantInvoiceNumber,
	callbackPath,
}: {
	amount: string;
	payerReference: string;
	merchantInvoiceNumber: string;
	callbackPath: string;
}) => {
	const bKashIdToken = await getBkashIdToken();

	if (!bKashIdToken) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"bKash id token not found",
		);
	}

	const createPaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/create`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer ${bKashIdToken}`,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				mode: "0011",
				payerReference,
				callbackURL: `${config.bkash_callback_url}${callbackPath}`,
				amount,
				currency: "BDT",
				intent: "sale",
				merchantInvoiceNumber,
			}),
		},
	);

	const createPaymentResult = await createPaymentResponse.json();

	console.log({ bKashCreatePaymentResult: createPaymentResult });

	// check if the response is ok or not, if not, throw an error
	if (!createPaymentResponse.ok) {
		console.error("bKash create payment failed:", createPaymentResult);
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			createPaymentResult.statusMessage || "Failed to create bKash payment",
		);
	}

	return createPaymentResult;
};

// Execute (confirm) a payment after the customer returns from the bKash page.
export const executeBkashPayment = async (paymentID: string) => {
	const bKashIdToken = await getBkashIdToken();

	if (!bKashIdToken) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"bKash id token not found",
		);
	}

	const executePaymentResponse = await fetch(
		`${config.bkash_base_url}/tokenized/checkout/execute`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer ${bKashIdToken}`,
				"X-App-Key": config.bkash_app_key,
			},
			body: JSON.stringify({
				paymentID,
			}),
		},
	);

	const executePaymentResult = await executePaymentResponse.json();

	console.log("bKash execute payment result:", executePaymentResult);

	if (!executePaymentResponse.ok) {
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			executePaymentResult.statusMessage || "Failed to execute bKash payment",
		);
	}

	return executePaymentResult;
};

// The gateway call got no definitive answer (timeout, dropped connection,
// unparseable response). The request may still have been processed by bKash,
// so callers must reconcile the payment instead of blindly retrying.
export class BkashAmbiguousError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "BkashAmbiguousError";
	}
}

// Issue a refund against an already paid transaction. A definitive gateway
// rejection throws AppError (the refund definitely did not happen, safe to
// retry); an undeterminable outcome throws BkashAmbiguousError (the payment
// must be reconciled before any retry).
export const refundBkashPayment = async ({
	paymentID,
	trxID,
	amount,
	reason,
	sku,
}: {
	paymentID?: string;
	trxID?: string;
	amount: string;
	reason: string;
	sku: string;
}) => {
	const bKashIdToken = await getBkashIdToken();

	if (!bKashIdToken) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"bKash id token not found",
		);
	}

	try {
		const refundPaymentResponse = await fetch(
			`${config.bkash_base_url}/tokenized/checkout/payment/refund`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer ${bKashIdToken}`,
					"X-App-Key": config.bkash_app_key,
				},
				body: JSON.stringify({
					paymentID,
					trxID,
					amount,
					sku,
					reason,
				}),
				// a hung gateway call must surface as an error instead of
				// blocking the caller forever
				signal: AbortSignal.timeout(30_000),
			},
		);

		const refundPaymentResult = await refundPaymentResponse.json();

		console.log({ bKashRefundPaymentResult: refundPaymentResult });

		if (!refundPaymentResponse.ok) {
			console.error("bKash refund payment failed:", refundPaymentResult);
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				refundPaymentResult.statusMessage || "Failed to refund bKash payment",
			);
		}

		// bKash answers HTTP 200 with a business status code; only "0000" is success
		if (
			refundPaymentResult.statusCode &&
			refundPaymentResult.statusCode !== "0000"
		) {
			console.error("bKash refund payment rejected:", refundPaymentResult);
			throw new AppError(
				httpStatus.BAD_GATEWAY,
				refundPaymentResult.statusMessage || "Failed to refund bKash payment",
			);
		}

		return refundPaymentResult;
	} catch (error) {
		if (error instanceof AppError) {
			throw error;
		}
		// timeout / network failure / unparseable body: the request may still
		// have reached bKash, so the outcome is unknown
		console.error("bKash refund outcome unknown:", error);
		throw new BkashAmbiguousError(
			"bKash refund outcome could not be determined",
			{ cause: error },
		);
	}
};
