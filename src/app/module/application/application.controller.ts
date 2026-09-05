import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ApplicationServices } from "./application.service";

// Apply for a room (TENANT)
const applyForRoom = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await ApplicationServices.applyForRoom(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Application submitted successfully",
		data: result,
	});
});

// My applications (TENANT)
const getMyApplications = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await ApplicationServices.getMyApplications(
		user,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Applications fetched successfully",
		data,
		meta,
	});
});

// Applications on my rooms (OWNER)
const getOwnerApplications = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await ApplicationServices.getOwnerApplications(
		user,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Applications fetched successfully",
		data,
		meta,
	});
});

// Single application detail
const getApplicationDetail = catchAsync(async (req: Request, res: Response) => {
	const applicationId = req.params.applicationId as string;
	const user = req.user!;

	const result = await ApplicationServices.getApplicationDetail(
		applicationId,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Application fetched successfully",
		data: result,
	});
});

// Approve/reject an application (OWNER)
const reviewApplication = catchAsync(async (req: Request, res: Response) => {
	const applicationId = req.params.applicationId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await ApplicationServices.reviewApplication(
		applicationId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Application reviewed successfully",
		data: result,
	});
});

// Pay the booking deposit (TENANT)
const payDeposit = catchAsync(async (req: Request, res: Response) => {
	const applicationId = req.params.applicationId as string;
	const user = req.user!;

	const result = await ApplicationServices.payDeposit(
		applicationId,
		user,
		req.body,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment session created successfully",
		data: result,
	});
});

// Cancel an application (TENANT/ADMIN)
const cancelApplication = catchAsync(async (req: Request, res: Response) => {
	const applicationId = req.params.applicationId as string;
	const user = req.user!;

	const result = await ApplicationServices.cancelApplication(
		applicationId,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Application cancelled successfully",
		data: result,
	});
});

export const ApplicationController = {
	applyForRoom,
	getMyApplications,
	getOwnerApplications,
	getApplicationDetail,
	reviewApplication,
	payDeposit,
	cancelApplication,
};
