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

// Payments awaiting refund reconciliation
const getPendingRefundPayments = catchAsync(
	async (req: Request, res: Response) => {
		const { data, meta } = await AdminServices.getPendingRefundPayments(
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Pending refund payments fetched successfully",
			data,
			meta,
		});
	},
);

// Resolve a pending refund payment
const resolvePendingRefundPayment = catchAsync(
	async (req: Request, res: Response) => {
		const paymentId = req.params.paymentId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await AdminServices.resolvePendingRefundPayment(
			paymentId,
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Pending refund resolved successfully",
			data: result,
		});
	},
);

// Payments awaiting settlement reconciliation
const getPendingSettlementPayments = catchAsync(
	async (req: Request, res: Response) => {
		const { data, meta } = await AdminServices.getPendingSettlementPayments(
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Pending settlement payments fetched successfully",
			data,
			meta,
		});
	},
);

// Resolve a pending settlement payment
const resolvePendingSettlementPayment = catchAsync(
	async (req: Request, res: Response) => {
		const paymentId = req.params.paymentId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await AdminServices.resolvePendingSettlementPayment(
			paymentId,
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Pending settlement resolved successfully",
			data: result,
		});
	},
);

// Pending tenant identity verifications
const getPendingTenantVerifications = catchAsync(
	async (req: Request, res: Response) => {
		const { data, meta } = await AdminServices.getPendingTenantVerifications(
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Pending tenant verifications fetched successfully",
			data,
			meta,
		});
	},
);

// Review (approve/reject) a tenant verification
const reviewTenantVerification = catchAsync(
	async (req: Request, res: Response) => {
		const tenantProfileId = req.params.tenantProfileId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await AdminServices.reviewTenantVerification(
			tenantProfileId,
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Tenant verification reviewed successfully",
			data: result,
		});
	},
);

export const AdminController = {
	getAdminDashboardStats,
	getAllUsers,
	updateUserStatus,
	updateUserRole,
	getAuditLogs,
	getPendingRefundPayments,
	resolvePendingRefundPayment,
	getPendingSettlementPayments,
	resolvePendingSettlementPayment,
	getPendingTenantVerifications,
	reviewTenantVerification,
};
