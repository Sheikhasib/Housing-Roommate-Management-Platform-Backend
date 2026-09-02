import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { LeaseServices } from "./lease.service";

// My leases (TENANT)
const getMyLeases = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await LeaseServices.getMyLeases(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Leases fetched successfully",
		data,
		meta,
	});
});

// Leases on my rooms (OWNER)
const getOwnerLeases = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await LeaseServices.getOwnerLeases(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Leases fetched successfully",
		data,
		meta,
	});
});

// Single lease detail
const getLeaseDetail = catchAsync(async (req: Request, res: Response) => {
	const leaseId = req.params.leaseId as string;
	const user = req.user!;

	const result = await LeaseServices.getLeaseDetail(leaseId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Lease fetched successfully",
		data: result,
	});
});

// Terminate a lease
const terminateLease = catchAsync(async (req: Request, res: Response) => {
	const leaseId = req.params.leaseId as string;
	const reason = req.body?.reason as string;
	const user = req.user!;

	const result = await LeaseServices.terminateLease(leaseId, reason, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Lease terminated successfully",
		data: result,
	});
});

// Upload a document to a lease (multipart: document + name)
const uploadLeaseDocument = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const leaseId = req.params.leaseId as string;
		const name = req.body?.name as string | undefined;
		const user = req.user!;

		if (!req.file) {
			throw new AppError(httpStatus.BAD_REQUEST, "No document uploaded");
		}

		const result = await LeaseServices.uploadLeaseDocument(
			leaseId,
			name || "rental-agreement",
			req.file.buffer,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			success: true,
			message: "Lease document uploaded successfully",
			data: result,
		});
	},
);

// Remove a lease document
const removeLeaseDocument = catchAsync(async (req: Request, res: Response) => {
	const leaseId = req.params.leaseId as string;
	const documentId = req.params.documentId as string;
	const user = req.user!;

	const result = await LeaseServices.removeLeaseDocument(
		leaseId,
		documentId,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Lease document removed successfully",
		data: result,
	});
});

export const LeaseController = {
	getMyLeases,
	getOwnerLeases,
	getLeaseDetail,
	terminateLease,
	uploadLeaseDocument,
	removeLeaseDocument,
};
