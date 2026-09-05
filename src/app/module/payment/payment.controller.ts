import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PaymentServices } from "./payment.service";

// Enabled payment gateways (public)
const getGateways = catchAsync(async (req: Request, res: Response) => {
	const result = PaymentServices.getGateways();

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment gateways fetched successfully",
		data: result,
	});
});

// bKash callback - redirects the browser after the payment page
const paymentCallback = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const result = await PaymentServices.paymentCallback(
			req.query as Record<string, any>,
		);

		res.redirect(result.redirectUrl);
	},
);

// SSLCommerz confirm - browser POST after the hosted page; validates against
// the SSLCommerz validator and redirects the payer to the frontend
const confirmPayment = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const result = await PaymentServices.confirmSslcommerzPayment(
			req.query as Record<string, any>,
			req.body ?? {},
		);

		res.redirect(result.redirectUrl);
	},
);

// SSLCommerz IPN - server-to-server notification; same confirmation flow but
// answered with a JSON 200 ack (an error envelope would trigger endless
// provider retries)
const handleIpn = catchAsync(async (req: Request, res: Response) => {
	const result = await PaymentServices.confirmSslcommerzPayment(
		req.query as Record<string, any>,
		req.body ?? {},
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment IPN processed successfully",
		data: {
			status: result.paymentStatus,
			alreadyProcessed: result.alreadyProcessed,
		},
	});
});

// My payments (TENANT)
const getMyPayments = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await PaymentServices.getMyPayments(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments fetched successfully",
		data,
		meta,
	});
});

// All payments (ADMIN)
const getAllPayments = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await PaymentServices.getAllPayments(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payments fetched successfully",
		data,
		meta,
	});
});

// Single payment detail
const getSinglePayment = catchAsync(async (req: Request, res: Response) => {
	const paymentId = req.params.paymentId as string;
	const user = req.user!;

	const result = await PaymentServices.getSinglePayment(paymentId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment fetched successfully",
		data: result,
	});
});

// Stripe webhook - raw body (signature verification needs the exact bytes,
// so the route is mounted BEFORE the JSON parsers in app.ts)
const stripeWebhook = catchAsync(async (req: Request, res: Response) => {
	const signature = req.headers["stripe-signature"] as string;

	const result = await PaymentServices.stripeWebhook(
		req.body as Buffer,
		signature,
	);

	// Stripe requires a 2xx ack; the standard error envelope would trigger
	// endless provider retries
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Stripe webhook processed successfully",
		data: result,
	});
});

export const PaymentController = {
	getGateways,
	paymentCallback,
	confirmPayment,
	handleIpn,
	stripeWebhook,
	getMyPayments,
	getAllPayments,
	getSinglePayment,
};
