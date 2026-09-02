import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { TenantServices } from "./tenant.service";

// Update my tenant profile
const updateMyTenantProfile = catchAsync(
	async (req: Request, res: Response) => {
		const payload = req.body;
		const user = req.user!;

		const result = await TenantServices.updateMyTenantProfile(payload, user);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Tenant profile updated successfully",
			data: result,
		});
	},
);

// Get my tenant profile
const getMyTenantProfile = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await TenantServices.getMyTenantProfile(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Tenant profile fetched successfully",
		data: result,
	});
});

export const TenantController = {
	updateMyTenantProfile,
	getMyTenantProfile,
};
