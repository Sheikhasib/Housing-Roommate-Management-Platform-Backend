import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { PaymentServices } from "./payment.service";

// bKash callback - redirects the browser after the payment page
const paymentCallback = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const result = await PaymentServices.paymentCallback(
			req.query as Record<string, any>,
		);

		res.redirect(result.redirectUrl);
	},
);

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

export const PaymentController = {
	paymentCallback,
	getMyPayments,
	getAllPayments,
	getSinglePayment,
};
