import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { UserServices } from "./user.service";

// Upload profile image
const uploadProfileImage = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const userId = req.user?.userId;

		// Check if a file was uploaded
		if (!req.file) {
			throw new AppError(httpStatus.BAD_REQUEST, "No file uploaded");
		}

		const result = await UserServices.uploadProfileImage(
			req.file?.buffer,
			userId as string,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "User profile image uploaded successfully",
			data: result,
		});
	},
);

// Update my profile (display name for now)
const updateMyProfile = catchAsync(async (req: Request, res: Response) => {
	const userId = req.user?.userId;
	const payload = req.body;

	const result = await UserServices.updateUserProfile(
		userId as string,
		payload,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Profile updated successfully",
		data: result,
	});
});

export const UserController = {
	uploadProfileImage,
	updateMyProfile,
};
