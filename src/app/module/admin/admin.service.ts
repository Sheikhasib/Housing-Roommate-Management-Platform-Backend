import httpStatus from "http-status";
import {
	ApplicationStatus,
	LeaseStatus,
	MaintenanceStatus,
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
import type {
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
	const totalPaidResult = await prisma.payment.aggregate({
		where: { status: PaymentStatus.PAID },
		_sum: { amount: true },
	});
	const totalRefundedResult = await prisma.payment.aggregate({
		where: { status: PaymentStatus.REFUNDED },
		_sum: { amount: true },
	});

	const totalRevenue =
		(totalPaidResult._sum.amount?.toNumber() || 0) -
		(totalRefundedResult._sum.amount?.toNumber() || 0);

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
				},
			},
			ownerProfile: {
				select: { id: true, verificationStatus: true, companyName: true },
			},
			_count: { select: { notifications: true } },
		},
	});

	const total = await prisma.user.count({ where: { AND: andConditions } });

	return {
		data: users,
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

	const updatedUser = await prisma.user.update({
		where: { id: userId },
		data: { status: payload.status as UserStatus },
		omit: { password: true },
	});

	await writeAuditLog({
		action: payload.status === "BLOCKED" ? "USER_BLOCKED" : "USER_UNBLOCKED",
		entity: "User",
		entityId: userId,
		actorId: admin.userId,
		actorEmail: admin.email,
		actorRole: admin.role,
		before: { status: targetUser.status },
		after: { status: payload.status, reason: payload.reason },
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

		// role profile consistency: an account promoted to TENANT/OWNER gets the
		// matching profile if it does not have one yet.
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

		return updatedUser;
	});

	await writeAuditLog({
		action: "USER_ROLE_CHANGED",
		entity: "User",
		entityId: userId,
		actorId: admin.userId,
		actorEmail: admin.email,
		actorRole: admin.role,
		before: { role: targetUser.role },
		after: { role: payload.role, reason: payload.reason },
	});

	return transactionResult;
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
};
