import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ViewingServices } from "./viewing.service";

// Request a viewing (TENANT)
const createViewingRequest = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await ViewingServices.createViewingRequest(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Viewing request submitted successfully",
		data: result,
	});
});

// My viewing requests (TENANT)
const getMyViewingRequests = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await ViewingServices.getMyViewingRequests(
		user,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Viewing requests fetched successfully",
		data,
		meta,
	});
});

// Viewing requests on my rooms (OWNER)
const getOwnerViewingRequests = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } = await ViewingServices.getOwnerViewingRequests(
			user,
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Viewing requests fetched successfully",
			data,
			meta,
		});
	},
);

// Update viewing status (OWNER/ADMIN)
const updateViewingStatus = catchAsync(async (req: Request, res: Response) => {
	const requestId = req.params.requestId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await ViewingServices.updateViewingStatus(
		requestId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Viewing request updated successfully",
		data: result,
	});
});

// Cancel my viewing request (TENANT)
const cancelViewingRequest = catchAsync(async (req: Request, res: Response) => {
	const requestId = req.params.requestId as string;
	const user = req.user!;

	const result = await ViewingServices.cancelViewingRequest(requestId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Viewing request cancelled successfully",
		data: result,
	});
});

export const ViewingController = {
	createViewingRequest,
	getMyViewingRequests,
	getOwnerViewingRequests,
	updateViewingStatus,
	cancelViewingRequest,
};
