import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { OwnerServices } from "./owner.service";

// Verify (approve/reject) an owner profile (ADMIN)
const verifyOwnerProfile = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await OwnerServices.verifyOwnerProfile(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owner verification status updated successfully",
		data: result,
	});
});

// Upload verification documents (multipart: docs[])
const uploadVerificationDocuments = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const user = req.user!;
		const files = (req.files as Express.Multer.File[]) || [];

		const buffers = files.map((file) => file.buffer);

		const result = await OwnerServices.uploadVerificationDocuments(
			user,
			buffers,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Verification documents uploaded successfully",
			data: result,
		});
	},
);

// Remove a verification document by publicId
const removeVerificationDocument = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;
		const publicId = req.body?.publicId as string;

		if (!publicId) {
			throw new AppError(httpStatus.BAD_REQUEST, "publicId is required");
		}

		const result = await OwnerServices.removeVerificationDocument(
			user,
			publicId,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Verification document removed successfully",
			data: result,
		});
	},
);

// Re-submit owner profile for verification
const requestVerification = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await OwnerServices.requestVerification(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owner verification request submitted successfully",
		data: result,
	});
});

// Update my owner profile
const updateMyOwnerProfile = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await OwnerServices.updateMyOwnerProfile(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owner profile updated successfully",
		data: result,
	});
});

// Get my owner profile
const getMyOwnerProfile = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await OwnerServices.getMyOwnerProfile(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owner profile fetched successfully",
		data: result,
	});
});

// Get all owners (ADMIN)
const getAllOwners = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await OwnerServices.getAllOwners(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Owners fetched successfully",
		data,
		meta,
	});
});

export const OwnerController = {
	verifyOwnerProfile,
	uploadVerificationDocuments,
	removeVerificationDocument,
	requestVerification,
	updateMyOwnerProfile,
	getMyOwnerProfile,
	getAllOwners,
};
