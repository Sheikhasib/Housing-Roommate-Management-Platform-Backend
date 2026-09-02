import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AnalyticsServices } from "./analytics.service";

// Tenant analytics
const getTenantAnalytics = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await AnalyticsServices.getTenantAnalytics(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Tenant analytics fetched successfully",
		data: result,
	});
});

// Owner analytics
const getOwnerAnalytics = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await AnalyticsServices.getOwnerAnalytics(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owner analytics fetched successfully",
		data: result,
	});
});

export const AnalyticsController = {
	getTenantAnalytics,
	getOwnerAnalytics,
};
