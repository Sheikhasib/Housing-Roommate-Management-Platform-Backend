import httpStatus from "http-status";
import {
	ApplicationStatus,
	LeaseStatus,
	MaintenanceStatus,
	NotificationType,
	OwnerVerificationStatus,
	PaymentStatus,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type {
	AuditLogWhereInput,
	UserWhereInput,
} from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { createNotification } from "../../utils/notification";
import type {
	IResolvePendingRefundPayload,
	IUpdateUserRolePayload,
	IUpdateUserStatusPayload,
} from "./admin.interface";

// Platform-wide dashboard statistics (ADMIN)
const getAdminDashboardStats = async () => {
	// users
	const totalUsers = await prisma.user.count({ where: { isDeleted: false } });
	const totalTenants = await prisma.user.count({
		where: { role: Role.TENANT, isDeleted: false },
	});
	const totalOwners = await prisma.user.count({
		where: { role: Role.OWNER, isDeleted: false },
	});
	const totalAdmins = await prisma.user.count({
		where: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] }, isDeleted: false },
	});
	const blockedUsers = await prisma.user.count({
		where: { status: UserStatus.BLOCKED, isDeleted: false },
	});

	// owner verification queue
	const pendingOwnerVerifications = await prisma.ownerProfile.count({
		where: {
			verificationStatus: OwnerVerificationStatus.PENDING,
			isDeleted: false,
		},
	});

	// properties & rooms
	const totalProperties = await prisma.property.count({
		where: { isDeleted: false },
	});
	const totalRooms = await prisma.room.count({ where: { isDeleted: false } });

	// occupancy
	const occupancyAggregate = await prisma.room.aggregate({
		where: { isDeleted: false },
		_sum: { bedCount: true, occupiedBeds: true },
	});
	const totalBeds = occupancyAggregate._sum.bedCount || 0;
	const occupiedBeds = occupancyAggregate._sum.occupiedBeds || 0;

	// applications & leases
	const totalApplications = await prisma.application.count({
		where: { isDeleted: false },
	});
	const pendingApplications = await prisma.application.count({
		where: { status: ApplicationStatus.PENDING, isDeleted: false },
	});
	const activeLeases = await prisma.lease.count({
		where: { status: LeaseStatus.ACTIVE, isDeleted: false },
	});

	// maintenance
	const openMaintenanceRequests = await prisma.maintenanceRequest.count({
		where: {
			status: {
				in: [
					MaintenanceStatus.OPEN,
					MaintenanceStatus.ASSIGNED,
					MaintenanceStatus.IN_PROGRESS,
				],
			},
			isDeleted: false,
		},
	});

	// payments / revenue
	// refunded deposits are moved to REFUNDED (or parked in REFUND_PENDING
	// while a refund is in flight) - neither is PAID, so summing PAID already
	// nets them out - never subtract REFUNDED again.
	const totalPaidResult = await prisma.payment.aggregate({
		where: { status: PaymentStatus.PAID },
		_sum: { amount: true },
	});

	const totalRevenue = totalPaidResult._sum.amount?.toNumber() || 0;

	return {
		totalUsers,
		totalTenants,
		totalOwners,
		totalAdmins,
		blockedUsers,
		pendingOwnerVerifications,
		totalProperties,
		totalRooms,
		totalBeds,
		occupiedBeds,
		occupancyRate: totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
		totalApplications,
		pendingApplications,
		activeLeases,
		openMaintenanceRequests,
		totalRevenue,
	};
};

// List all users with filters/pagination
const getAllUsers = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: UserWhereInput[] = [{ isDeleted: false }];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	if (query.role) {
		andConditions.push({ role: query.role });
	}

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const users = await prisma.user.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		omit: { password: true },
		include: {
			tenantProfile: {
				select: {
					id: true,
					preferredCity: true,
					lookingForRoommate: true,
					occupation: true,
					isDeleted: true,
				},
			},
			ownerProfile: {
				select: {
					id: true,
					verificationStatus: true,
					companyName: true,
					isDeleted: true,
				},
			},
			_count: { select: { notifications: true } },
		},
	});

	const total = await prisma.user.count({ where: { AND: andConditions } });

	// never surface the profile of a soft-deleted user account
	const data = users.map((user) => {
		const { tenantProfile, ownerProfile, ...rest } = user;

		return {
			...rest,
			tenantProfile: tenantProfile?.isDeleted
				? null
				: tenantProfile
					? {
							id: tenantProfile.id,
							preferredCity: tenantProfile.preferredCity,
							lookingForRoommate: tenantProfile.lookingForRoommate,
							occupation: tenantProfile.occupation,
						}
					: null,
			ownerProfile: ownerProfile?.isDeleted
				? null
				: ownerProfile
					? {
							id: ownerProfile.id,
							verificationStatus: ownerProfile.verificationStatus,
							companyName: ownerProfile.companyName,
						}
					: null,
		};
	});

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Block or unblock a user
const updateUserStatus = async (
	userId: string,
	payload: IUpdateUserStatusPayload,
	admin: RequestUser,
) => {
	const targetUser = await prisma.user.findUnique({
		where: { id: userId },
	});

	if (!targetUser || targetUser.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	// never block yourself / another super admin
	if (userId === admin.userId || targetUser.role === Role.SUPER_ADMIN) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change the status of this account",
		);
	}

	if (targetUser.status === payload.status) {
		throw new AppError(
			httpStatus.CONFLICT,
			`User is already ${payload.status.toLowerCase()}`,
		);
	}

	const updatedUser = await prisma.$transaction(async (tx) => {
		const updated = await tx.user.update({
			where: { id: userId },
			data: { status: payload.status as UserStatus },
			omit: { password: true },
		});

		// status change + audit commit atomically
		await writeAuditLog(
			{
				action:
					payload.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UNBLOCKED",
				entity: "User",
				entityId: userId,
				actorId: admin.userId,
				actorEmail: admin.email,
				actorRole: admin.role,
				before: { status: targetUser.status },
				after: { status: payload.status, reason: payload.reason },
			},
			tx,
		);

		return updated;
	});

	return updatedUser;
};

// Change a user's role (SUPER_ADMIN only)
const updateUserRole = async (
	userId: string,
	payload: IUpdateUserRolePayload,
	admin: RequestUser,
) => {
	const targetUser = await prisma.user.findUnique({
		where: { id: userId },
	});

	if (!targetUser || targetUser.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	if (admin.role !== Role.SUPER_ADMIN) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only a super admin can change user roles",
		);
	}

	if (userId === admin.userId) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot change your own role",
		);
	}

	if (targetUser.role === payload.role) {
		throw new AppError(httpStatus.CONFLICT, "User already has this role");
	}

	const transactionResult = await prisma.$transaction(async (tx) => {
		const updatedUser = await tx.user.update({
			where: { id: userId },
			data: { role: payload.role as Role },
			omit: { password: true },
		});

		// role profile consistency: an account promoted to
		// TENANT/OWNER/PROPERTY_MANAGER gets the matching profile if it does not
		// have one yet.
		if (payload.role === Role.TENANT) {
			const existing = await tx.tenantProfile.findUnique({
				where: { userId },
			});
			if (!existing) {
				await tx.tenantProfile.create({
					data: {
						userId,
						name: targetUser.name,
						email: targetUser.email,
					},
				});
			}
		}

		if (payload.role === Role.OWNER) {
			const existing = await tx.ownerProfile.findUnique({
				where: { userId },
			});
			if (!existing) {
				await tx.ownerProfile.create({
					data: {
						userId,
						name: targetUser.name,
						email: targetUser.email,
						verificationStatus: OwnerVerificationStatus.PENDING,
					},
				});
			}
		}

		if (payload.role === Role.PROPERTY_MANAGER) {
			const existing = await tx.managerProfile.findUnique({
				where: { userId },
			});
			if (!existing) {
				await tx.managerProfile.create({
					data: {
						userId,
						name: targetUser.name,
						email: targetUser.email,
					},
				});
			}
		}

		// role change + audit commit atomically
		await writeAuditLog(
			{
				action: "USER_ROLE_CHANGED",
				entity: "User",
				entityId: userId,
				actorId: admin.userId,
				actorEmail: admin.email,
				actorRole: admin.role,
				before: { role: targetUser.role },
				after: { role: payload.role, reason: payload.reason },
			},
			tx,
		);

		return updatedUser;
	});

	return transactionResult;
};

// Payments parked in REFUND_PENDING: a bKash refund whose outcome could not be
// determined (timeout / dropped response). Admins verify the actual outcome in
// the bKash merchant portal (the API offers no refund-status query) and
// resolve them here.
const getPendingRefundPayments = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const where = { status: PaymentStatus.REFUND_PENDING };

	const payments = await prisma.payment.findMany({
		where,
		take: limit,
		skip,
		// oldest first: they have been stuck the longest
		orderBy: { updatedAt: "asc" },
		include: {
			application: {
				select: {
					id: true,
					tenantProfile: { select: { name: true, email: true } },
					lease: { select: { id: true, status: true } },
				},
			},
		},
	});

	const total = await prisma.payment.count({ where });

	return {
		data: payments,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Resolve a stuck REFUND_PENDING payment after verifying the outcome in the
// bKash merchant portal. REFUNDED records the completed refund (a still-active
// lease can then be terminated again without a second refund); NOT_REFUNDED
// restores PAID so the tenant can retry the termination.
const resolvePendingRefundPayment = async (
	paymentId: string,
	payload: IResolvePendingRefundPayload,
	admin: RequestUser,
) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		include: {
			application: {
				select: { tenantProfile: { select: { userId: true } } },
			},
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	if (payment.status !== PaymentStatus.REFUND_PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Payment is not awaiting refund reconciliation (status: ${payment.status.toLowerCase()})`,
		);
	}

	const refunded = payload.outcome === "REFUNDED";
	const tenantUserId = payment.application?.tenantProfile?.userId;

	const updatedPayment = await prisma.$transaction(async (tx) => {
		// conditional write: only a still-pending payment can be resolved
		const resolved = await tx.payment.updateMany({
			where: { id: paymentId, status: PaymentStatus.REFUND_PENDING },
			data: refunded
				? {
						status: PaymentStatus.REFUNDED,
						refundTrxId: payload.refundTrxId || payment.refundTrxId,
						refundAt: new Date().toISOString(),
						refundAmount: payment.amount,
						refundReason: payload.note || "Reconciled by admin",
					}
				: { status: PaymentStatus.PAID },
		});

		if (resolved.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Payment was already reconciled by another request",
			);
		}

		const updated = await tx.payment.findUniqueOrThrow({
			where: { id: paymentId },
		});

		// money decisions are always audited
		await writeAuditLog(
			{
				action: "PENDING_REFUND_RESOLVED",
				entity: "Payment",
				entityId: paymentId,
				actorId: admin.userId,
				actorEmail: admin.email,
				actorRole: admin.role,
				before: { status: PaymentStatus.REFUND_PENDING },
				after: refunded
					? {
							status: PaymentStatus.REFUNDED,
							refundTrxId: payload.refundTrxId,
						}
					: { status: PaymentStatus.PAID },
			},
			tx,
		);

		return updated;
	});

	if (tenantUserId) {
		await createNotification({
			userId: tenantUserId,
			type: NotificationType.PAYMENT,
			title: refunded ? "Deposit refund confirmed 💰" : "Deposit refund update",
			message: refunded
				? "Your booking deposit refund has been confirmed. If your lease is still active you can terminate it again - no second refund will be attempted."
				: "Your booking deposit could not be refunded by bKash. Your payment is intact and you may retry the lease termination.",
			data: { paymentId },
		});
	}

	return updatedPayment;
};

// Read the audit trail with filters
const getAuditLogs = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 20;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: AuditLogWhereInput[] = [];

	if (query.action) {
		andConditions.push({
			action: { contains: query.action, mode: "insensitive" },
		});
	}
	if (query.entity) {
		andConditions.push({
			entity: { equals: query.entity, mode: "insensitive" },
		});
	}
	if (query.actorId) {
		andConditions.push({ actorId: query.actorId });
	}
	if (query.actorEmail) {
		andConditions.push({
			actorEmail: { contains: query.actorEmail, mode: "insensitive" },
		});
	}

	const auditLogs = await prisma.auditLog.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
	});

	const total = await prisma.auditLog.count({ where: { AND: andConditions } });

	return {
		data: auditLogs,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

export const AdminServices = {
	getAdminDashboardStats,
	getAllUsers,
	updateUserStatus,
	updateUserRole,
	getAuditLogs,
	getPendingRefundPayments,
	resolvePendingRefundPayment,
};
