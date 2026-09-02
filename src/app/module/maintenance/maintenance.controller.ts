import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { MaintenanceServices } from "./maintenance.service";

// Create a maintenance request (TENANT)
const createMaintenanceRequest = catchAsync(
	async (req: Request, res: Response) => {
		const payload = req.body;
		const user = req.user!;

		const result = await MaintenanceServices.createMaintenanceRequest(
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.CREATED,
			success: true,
			message: "Maintenance request created successfully",
			data: result,
		});
	},
);

// My maintenance requests (TENANT)
const getMyMaintenanceRequests = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } = await MaintenanceServices.getMyMaintenanceRequests(
			user,
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Maintenance requests fetched successfully",
			data,
			meta,
		});
	},
);

// Maintenance requests on my rooms (OWNER)
const getOwnerMaintenanceRequests = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } =
			await MaintenanceServices.getOwnerMaintenanceRequests(user, req.query);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Maintenance requests fetched successfully",
			data,
			meta,
		});
	},
);

// Update maintenance status (OWNER/ADMIN)
const updateMaintenanceStatus = catchAsync(
	async (req: Request, res: Response) => {
		const requestId = req.params.requestId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await MaintenanceServices.updateMaintenanceStatus(
			requestId,
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Maintenance request updated successfully",
			data: result,
		});
	},
);

// Upload an image to a maintenance request
const uploadMaintenanceImage = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const requestId = req.params.requestId as string;
		const user = req.user!;

		if (!req.file) {
			throw new AppError(httpStatus.BAD_REQUEST, "No image uploaded");
		}

		const result = await MaintenanceServices.uploadMaintenanceImage(
			requestId,
			req.file.buffer,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Maintenance image uploaded successfully",
			data: result,
		});
	},
);

export const MaintenanceController = {
	createMaintenanceRequest,
	getMyMaintenanceRequests,
	getOwnerMaintenanceRequests,
	updateMaintenanceStatus,
	uploadMaintenanceImage,
};
