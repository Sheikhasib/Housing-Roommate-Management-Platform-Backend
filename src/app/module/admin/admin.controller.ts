import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AdminServices } from "./admin.service";

// Dashboard stats
const getAdminDashboardStats = catchAsync(
	async (req: Request, res: Response) => {
		const result = await AdminServices.getAdminDashboardStats();

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Dashboard statistics fetched successfully",
			data: result,
		});
	},
);

// All users
const getAllUsers = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminServices.getAllUsers(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Users fetched successfully",
		data,
		meta,
	});
});

// Update a user's status
const updateUserStatus = catchAsync(async (req: Request, res: Response) => {
	const userId = req.params.userId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await AdminServices.updateUserStatus(userId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User status updated successfully",
		data: result,
	});
});

// Update a user's role
const updateUserRole = catchAsync(async (req: Request, res: Response) => {
	const userId = req.params.userId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await AdminServices.updateUserRole(userId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User role updated successfully",
		data: result,
	});
});

// Audit logs
const getAuditLogs = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await AdminServices.getAuditLogs(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Audit logs fetched successfully",
		data,
		meta,
	});
});

export const AdminController = {
	getAdminDashboardStats,
	getAllUsers,
	updateUserStatus,
	updateUserRole,
	getAuditLogs,
};
