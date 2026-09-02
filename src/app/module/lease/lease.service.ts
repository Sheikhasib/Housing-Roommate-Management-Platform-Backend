import httpStatus from "http-status";
import {
	InvoiceStatus,
	LeaseStatus,
	NotificationType,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import { isAfter } from "date-fns";
import type { IQuery } from "../../interfaces";
import type { LeaseWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { refundBkashPayment } from "../../lib/bKash";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { writeAuditLog } from "../../utils/audit";
import { recalculateRoomStatus } from "../../utils/roomStatus";
import { uploadFileToCloudinary } from "../../utils/cloudinaryUpload";

// TENANT: my leases (active + history)
const getMyLeases = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: LeaseWhereInput[] = [
		{ tenantProfileId: tenantProfile.id, isDeleted: false },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const leases = await prisma.lease.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			room: {
				include: {
					property: {
						select: {
							id: true,
							title: true,
							city: true,
							area: true,
							images: true,
						},
					},
				},
			},
			invoices: true,
			documents: true,
			application: { include: { payment: true } },
		},
	});

	const total = await prisma.lease.count({ where: { AND: andConditions } });

	return {
		data: leases,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER: leases for their rooms
const getOwnerLeases = async (user: RequestUser, query: IQuery) => {
	const ownerProfile = await prisma.ownerProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: LeaseWhereInput[] = [
		{ isDeleted: false, room: { property: { ownerId: ownerProfile.id } } },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.roomId) {
		andConditions.push({ roomId: query.roomId });
	}

	const leases = await prisma.lease.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			tenantProfile: {
				select: {
					id: true,
					name: true,
					email: true,
					contactNumber: true,
					user: { select: { imageUrl: true } },
				},
			},
			room: {
				select: { id: true, name: true, monthlyRent: true },
			},
			invoices: true,
			application: { include: { payment: true } },
		},
	});

	const total = await prisma.lease.count({ where: { AND: andConditions } });

	return {
		data: leases,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Single lease detail (participants only)
const getLeaseDetail = async (leaseId: string, user: RequestUser) => {
	const lease = await prisma.lease.findUnique({
		where: { id: leaseId },
		include: {
			tenantProfile: {
				include: { user: { select: { id: true, name: true, imageUrl: true } } },
			},
			room: {
				include: {
					property: {
						include: {
							owner: {
								select: { id: true, userId: true, name: true, email: true },
							},
						},
					},
				},
			},
			invoices: { orderBy: { periodStart: "desc" } },
			documents: true,
			application: { include: { payment: true } },
		},
	});

	if (!lease || lease.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
	}

	const isTenant = lease.tenantProfile.userId === user.userId;
	const isOwner = lease.room.property.owner.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isTenant && !isOwner && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this lease",
		);
	}

	return lease;
};

// Terminate a lease (tenant / owner / admin). If the tenancy has not started
// yet, the booking deposit is refunded through bKash.
const terminateLease = async (
	leaseId: string,
	reason: string,
	user: RequestUser,
) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const lease = await tx.lease.findUnique({
			where: { id: leaseId },
			include: {
				tenantProfile: true,
				application: { include: { payment: true } },
				room: true,
			},
		});

		if (!lease || lease.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
		}

		const ownerProfile = lease.room.propertyId
			? await tx.ownerProfile.findFirst({
					where: { properties: { some: { id: lease.room.propertyId } } },
				})
			: null;

		const isTenant = lease.tenantProfile.userId === user.userId;
		const isOwner = ownerProfile?.userId === user.userId;
		const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

		if (!isTenant && !isOwner && !isAdmin) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not allowed to terminate this lease",
			);
		}

		if (lease.status !== LeaseStatus.ACTIVE) {
			throw new AppError(
				httpStatus.CONFLICT,
				`Lease is already ${lease.status.toLowerCase()}`,
			);
		}

		const updatedLease = await tx.lease.update({
			where: { id: leaseId },
			data: {
				status: LeaseStatus.TERMINATED,
				terminationReason: reason,
				terminatedBy: user.userId,
				terminatedAt: new Date(),
			},
		});

		// release the occupied bed (if the room still counts it)
		const room = await tx.room.findUnique({ where: { id: lease.roomId } });
		if (room && room.occupiedBeds > 0) {
			await tx.room.update({
				where: { id: room.id },
				data: { occupiedBeds: { decrement: 1 } },
			});
			await recalculateRoomStatus(room.id, tx);
		}

		// cancel all unpaid invoices of this lease (they are no longer due)
		await tx.invoice.updateMany({
			where: {
				leaseId: lease.id,
				status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PROCESSING] },
			},
			data: { status: InvoiceStatus.CANCELLED },
		});

		return { updatedLease, lease };
	});

	const { updatedLease, lease } = transactionResult;
	const payment = lease.application?.payment;

	// refund the deposit when the tenancy hasn't started yet
	let refundResult: Record<string, unknown> | null = null;

	const leaseHasNotStarted = isAfter(new Date(lease.startDate), new Date());

	if (payment?.status === PaymentStatus.PAID && leaseHasNotStarted) {
		refundResult = await refundBkashPayment({
			paymentID: payment.bKashPaymentId || undefined,
			trxID: payment.bKashTrxId || undefined,
			amount: payment.amount.toString(),
			sku: "Lease Termination (Deposit Refund)",
			reason: reason,
		});

		await prisma.payment.update({
			where: { id: payment.id },
			data: {
				status: PaymentStatus.REFUNDED,
				refundTrxId: (refundResult as any)?.refundTrxID || null,
				refundAt:
					(refundResult as any)?.completedTime || new Date().toISOString(),
				refundAmount: payment.amount,
				refundReason: reason,
				gatwayResponse: refundResult as any,
			},
		});
	}

	// audit trail
	await writeAuditLog({
		action: "LEASE_TERMINATED",
		entity: "Lease",
		entityId: leaseId,
		actorId: user.userId,
		actorEmail: user.email,
		actorRole: user.role,
		after: { status: LeaseStatus.TERMINATED, reason },
	});

	await createNotification({
		userId: lease.tenantProfile.userId,
		type: NotificationType.LEASE,
		title: "Lease terminated 📄",
		message: `Your lease for the room has been terminated. Reason: ${reason}`,
		data: { leaseId },
	});

	await sendTemplateEmail({
		to: lease.tenantProfile.email,
		subject: "Your Lease Has Been Terminated - Housing & Roommate",
		template: "lease-terminated",
		data: {
			name: lease.tenantProfile.name,
			reason,
			refunded: refundResult
				? "A full deposit refund was issued to your bKash account."
				: "No refund was applicable.",
		},
	});

	return {
		lease: updatedLease,
		refund: refundResult
			? {
					status: PaymentStatus.REFUNDED,
					refundTrxId: (refundResult as any)?.refundTrxID,
				}
			: null,
	};
};

// Tenant/owner attach a signed rental agreement document to a lease
const uploadLeaseDocument = async (
	leaseId: string,
	name: string,
	buffer: Buffer,
	user: RequestUser,
) => {
	const lease = await prisma.lease.findUnique({
		where: { id: leaseId },
		include: {
			tenantProfile: true,
			room: { include: { property: true } },
		},
	});

	if (!lease || lease.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
	}

	const isTenant = lease.tenantProfile.userId === user.userId;
	const isOwner =
		lease.room.property.ownerId ===
		(await prisma.ownerProfile.findUnique({ where: { userId: user.userId } }))
			?.id;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isTenant && !isOwner && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to upload documents to this lease",
		);
	}

	const uploadResult = await uploadFileToCloudinary(buffer, "lease-documents");

	return prisma.leaseDocument.create({
		data: {
			leaseId,
			name: name || uploadResult.original_filename || "lease-document",
			url: uploadResult.secure_url,
			publicId: uploadResult.public_id,
		},
	});
};

// Remove a lease document (owner/admin)
const removeLeaseDocument = async (
	leaseId: string,
	documentId: string,
	user: RequestUser,
) => {
	const lease = await prisma.lease.findUnique({ where: { id: leaseId } });

	if (!lease || lease.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
	}

	const ownerProfile = await prisma.ownerProfile.findUnique({
		where: { userId: user.userId },
	});
	const isOwner = lease.roomId
		? await prisma.room.findFirst({
				where: { id: lease.roomId, property: { ownerId: ownerProfile?.id } },
			})
		: null;

	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isOwner && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to remove documents from this lease",
		);
	}

	const document = await prisma.leaseDocument.findFirst({
		where: { id: documentId, leaseId },
	});

	if (!document) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease document not found");
	}

	await prisma.leaseDocument.delete({ where: { id: document.id } });

	return { message: "Lease document removed successfully" };
};

export const LeaseServices = {
	getMyLeases,
	getOwnerLeases,
	getLeaseDetail,
	terminateLease,
	uploadLeaseDocument,
	removeLeaseDocument,
};
