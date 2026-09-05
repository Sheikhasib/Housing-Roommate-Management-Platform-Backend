import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
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

// Upload/replace my identity verification document
const uploadVerificationDocument = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;
		const file = req.file;

		if (!file) {
			throw new AppError(httpStatus.BAD_REQUEST, "No document uploaded");
		}

		const result = await TenantServices.uploadVerificationDocument(
			file.buffer,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Verification document uploaded successfully",
			data: result,
		});
	},
);

export const TenantController = {
	updateMyTenantProfile,
	getMyTenantProfile,
	uploadVerificationDocument,
};
