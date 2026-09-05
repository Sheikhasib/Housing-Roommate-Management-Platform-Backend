import httpStatus from "http-status";
import {
	ApplicationStatus,
	InvoiceStatus,
	LeaseStatus,
	MaintenanceStatus,
	NotificationType,
	VerificationStatus,
	PaymentStatus,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type {
	AuditLogWhereInput,
	TenantProfileWhereInput,
	UserWhereInput,
} from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { settleFromProvider } from "../../lib/payments/settle";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import type {
	IResolvePendingRefundPayload,
	IResolvePendingSettlementPayload,
	IReviewTenantVerificationPayload,
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
	const totalManagers = await prisma.user.count({
		where: { role: Role.PROPERTY_MANAGER, isDeleted: false },
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
			verificationStatus: VerificationStatus.PENDING,
			isDeleted: false,
		},
	});

	// tenant verification queue
	const pendingTenantVerifications = await prisma.tenantProfile.count({
		where: {
			verificationStatus: VerificationStatus.PENDING,
			verificationDocUrl: { not: null },
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
		totalManagers,
		totalAdmins,
		blockedUsers,
		pendingOwnerVerifications,
		pendingTenantVerifications,
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
					verificationStatus: true,
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
			managerProfile: {
				select: {
					id: true,
					contactNumber: true,
					bio: true,
					isDeleted: true,
				},
			},
			_count: { select: { notifications: true } },
		},
	});

	const total = await prisma.user.count({ where: { AND: andConditions } });

	// never surface the profile of a soft-deleted user account
	const data = users.map((user) => {
		const { tenantProfile, ownerProfile, managerProfile, ...rest } = user;

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
							verificationStatus: tenantProfile.verificationStatus,
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
			managerProfile: managerProfile?.isDeleted
				? null
				: managerProfile
					? {
							id: managerProfile.id,
							contactNumber: managerProfile.contactNumber,
							bio: managerProfile.bio,
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
						verificationStatus: VerificationStatus.PENDING,
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

// Payments stuck in PROCESSING: a gateway session whose final notification
// never arrived (money possibly captured at the provider, nothing settled
// locally). Admins verify the actual outcome in the provider's portal and
// resolve them here - the success-side counterpart of the REFUND_PENDING
// queue.
const getPendingSettlementPayments = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const where = { status: PaymentStatus.PROCESSING };

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
					status: true,
					tenantProfile: { select: { name: true, email: true } },
					lease: { select: { id: true, status: true } },
				},
			},
			invoice: {
				select: {
					id: true,
					type: true,
					amount: true,
					lease: {
						select: {
							tenantProfile: { select: { name: true, email: true } },
						},
					},
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

// Resolve a stuck PROCESSING payment after verifying the provider's status.
// SETTLED runs the exact same guarded, amount-checked settle path a live
// gateway callback uses (lease/bed/invoice side effects included);
// NOT_SETTLED downgrades to FAILED (retryable) so the tenant can start a
// fresh session.
const resolvePendingSettlementPayment = async (
	paymentId: string,
	payload: IResolvePendingSettlementPayload,
	admin: RequestUser,
) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		include: {
			application: {
				select: { tenantProfile: { select: { userId: true } } },
			},
			invoice: {
				select: {
					lease: { select: { tenantProfile: { select: { userId: true } } } },
				},
			},
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	if (payment.status !== PaymentStatus.PROCESSING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Payment is not awaiting settlement reconciliation (status: ${payment.status.toLowerCase()})`,
		);
	}

	const settled = payload.outcome === "SETTLED";
	const tenantUserId =
		payment.application?.tenantProfile?.userId ??
		payment.invoice?.lease?.tenantProfile?.userId ??
		null;

	const updatedPayment = settled
		? // the admin confirmed the charge with the provider: settle through
			// the same amount-checked settle path a live callback uses (I-G2
			// compares against the snapshot the admin verified in the portal)
			await prisma.$transaction(async (tx) => {
				const settleResult = await settleFromProvider(
					{
						paymentId,
						executedResult: {
							trxID: payload.providerTrxId,
							paymentExecuteTime: new Date().toISOString(),
							resolvedBy: admin.email,
							note: payload.note,
							outcome: "SETTLED",
						},
						reportedAmountMinorUnits: payment.providerChargeAmount,
						actorId: admin.userId,
						actorEmail: admin.email,
						actorRole: admin.role,
						gateway: payment.gateway,
					},
					tx,
				);

				if (settleResult.outcome === "AMOUNT_MISMATCH") {
					throw new AppError(
						httpStatus.CONFLICT,
						"Provider-charged amount does not match the initiated amount. Payment held for review.",
					);
				}

				await writeAuditLog(
					{
						action: "PENDING_SETTLEMENT_RESOLVED",
						entity: "Payment",
						entityId: paymentId,
						actorId: admin.userId,
						actorEmail: admin.email,
						actorRole: admin.role,
						before: { status: PaymentStatus.PROCESSING },
						after: {
							outcome: "SETTLED",
							status: PaymentStatus.PAID,
							gateway: payment.gateway,
							providerTrxId: payload.providerTrxId,
							note: payload.note,
						},
					},
					tx,
				);

				return tx.payment.findUniqueOrThrow({
					where: { id: paymentId },
				});
			})
		: await prisma.$transaction(async (tx) => {
				// conditional write: only a still-PROCESSING payment can be resolved
				const resolved = await tx.payment.updateMany({
					where: { id: paymentId, status: PaymentStatus.PROCESSING },
					data: {
						status: PaymentStatus.FAILED,
						gatwayResponse: {
							resolvedBy: admin.email,
							note: payload.note,
							outcome: "NOT_SETTLED",
						} as any,
					},
				});

				if (resolved.count === 0) {
					throw new AppError(
						httpStatus.CONFLICT,
						"Payment was already reconciled by another request",
					);
				}

				// the invoice becomes payable again (mirrors the cancel path) so
				// the tenant can retry with a fresh session
				if (payment.invoiceId) {
					await tx.invoice.update({
						where: { id: payment.invoiceId },
						data: { status: InvoiceStatus.UNPAID },
					});
				}

				await writeAuditLog(
					{
						action: "PENDING_SETTLEMENT_RESOLVED",
						entity: "Payment",
						entityId: paymentId,
						actorId: admin.userId,
						actorEmail: admin.email,
						actorRole: admin.role,
						before: { status: PaymentStatus.PROCESSING },
						after: {
							outcome: "NOT_SETTLED",
							status: PaymentStatus.FAILED,
							gateway: payment.gateway,
							note: payload.note,
						},
					},
					tx,
				);

				return tx.payment.findUniqueOrThrow({
					where: { id: paymentId },
				});
			});

	// the resolution is committed: a notification failure must not 500 the
	// admin request
	if (tenantUserId) {
		try {
			await createNotification({
				userId: tenantUserId,
				type: NotificationType.PAYMENT,
				title: settled ? "Payment confirmed ✅" : "Payment update",
				message: settled
					? "Your payment has been confirmed and settled successfully."
					: "Your payment session could not be confirmed with the provider. No charge was settled - you can safely retry the payment.",
				data: { paymentId },
			});
		} catch (error) {
			console.log("Settlement-resolution notification failed:", error);
		}
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

// TENANT identity verification queue: PENDING tenants who actually uploaded a
// document, oldest first (they have been waiting the longest).
const getPendingTenantVerifications = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: TenantProfileWhereInput[] = [
		{ verificationStatus: VerificationStatus.PENDING },
		{ verificationDocUrl: { not: null } },
		{ isDeleted: false },
	];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	const where = { AND: andConditions };

	const tenants = await prisma.tenantProfile.findMany({
		where,
		take: limit,
		skip,
		orderBy: { createdAt: "asc" },
		select: {
			id: true,
			name: true,
			email: true,
			contactNumber: true,
			occupation: true,
			verificationDocUrl: true,
			verificationStatus: true,
			createdAt: true,
			user: {
				select: {
					id: true,
					name: true,
					email: true,
					role: true,
					status: true,
					imageUrl: true,
					createdAt: true,
				},
			},
		},
	});

	const total = await prisma.tenantProfile.count({ where });

	return {
		data: tenants,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Approve or reject a tenant's identity verification (mirrors the owner flow:
// audit + email + notification, and rejection requires a reason).
const reviewTenantVerification = async (
	tenantProfileId: string,
	payload: IReviewTenantVerificationPayload,
	admin: RequestUser,
) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { id: tenantProfileId },
	});

	if (!tenantProfile || tenantProfile.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	if (tenantProfile.verificationStatus !== VerificationStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Tenant verification has already been ${tenantProfile.verificationStatus.toLowerCase()}`,
		);
	}

	if (payload.verificationStatus === "REJECTED" && !payload.rejectionReason) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Rejection reason is required when rejecting a tenant",
		);
	}

	const isApproved = payload.verificationStatus === "APPROVED";

	const updatedTenantProfile = await prisma.$transaction(async (tx) => {
		// conditional write: only a still-PENDING verification can be reviewed
		const reviewed = await tx.tenantProfile.updateMany({
			where: {
				id: tenantProfileId,
				verificationStatus: VerificationStatus.PENDING,
			},
			data: {
				verificationStatus: payload.verificationStatus,
				rejectionReason: isApproved ? null : payload.rejectionReason,
				reviewedBy: admin.userId,
				reviewedAt: new Date(),
			},
		});

		if (reviewed.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Tenant verification was already reviewed by another request",
			);
		}

		const updated = await tx.tenantProfile.findUniqueOrThrow({
			where: { id: tenantProfileId },
		});

		await writeAuditLog(
			{
				action: isApproved ? "TENANT_APPROVED" : "TENANT_REJECTED",
				entity: "TenantProfile",
				entityId: tenantProfileId,
				actorId: admin.userId,
				actorEmail: admin.email,
				actorRole: admin.role,
				before: { verificationStatus: VerificationStatus.PENDING },
				after: {
					verificationStatus: payload.verificationStatus,
					rejectionReason: payload.rejectionReason,
				},
			},
			tx,
		);

		return updated;
	});

	// side effects must never fail the committed review
	try {
		await sendTemplateEmail({
			to: tenantProfile.email,
			subject: isApproved
				? "Your Tenant Account Has Been Approved"
				: "Your Tenant Account Verification Was Rejected",
			template: isApproved
				? "tenant-account-approved"
				: "tenant-account-rejected",
			data: {
				name: tenantProfile.name,
				reason: payload.rejectionReason,
			},
		});
	} catch (error) {
		console.log("Tenant verification email failed:", error);
	}

	try {
		await createNotification({
			userId: tenantProfile.userId,
			type: NotificationType.SYSTEM,
			title: isApproved
				? "Tenant account approved ✅"
				: "Tenant account rejected ❌",
			message: isApproved
				? "Your identity has been verified. You can now pay booking deposits and invoices."
				: `Your verification was rejected. Reason: ${payload.rejectionReason || "not provided"}. Please upload a new document.`,
			data: { tenantProfileId },
		});
	} catch (error) {
		console.log("Tenant verification notification failed:", error);
	}

	return updatedTenantProfile;
};

export const AdminServices = {
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
