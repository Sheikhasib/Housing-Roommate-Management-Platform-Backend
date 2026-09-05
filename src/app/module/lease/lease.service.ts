import httpStatus from "http-status";
import {
	InvoiceStatus,
	LeaseStatus,
	MembershipStatus,
	NotificationType,
	PaymentGateway,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import { isAfter } from "date-fns";
import type { IQuery } from "../../interfaces";
import type { LeaseWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { BkashAmbiguousError, refundBkashPayment } from "../../lib/bKash";
import { ProviderAmbiguousError } from "../../lib/payments/types";
import { refundStripePayment } from "../../lib/payments/adapters/stripe";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { propertyManagerScope } from "../../utils/propertyAccess";
import { writeAuditLog } from "../../utils/audit";
import { recalculateRoomStatus } from "../../utils/roomStatus";
import { uploadFileToCloudinary } from "../../utils/cloudinaryUpload";

// TENANT: my leases (active + history)
const getMyLeases = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
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

// OWNER / assigned MANAGER (view-only): leases for their (managed) rooms
const getOwnerLeases = async (user: RequestUser, query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: LeaseWhereInput[] = [];

	if (user.role === Role.PROPERTY_MANAGER) {
		// membership-based scope: only leases on rooms of assigned properties
		andConditions.push({
			isDeleted: false,
			room: { property: propertyManagerScope(user.userId) },
		});
	} else {
		const ownerProfile = await prisma.ownerProfile.findFirst({
			where: { userId: user.userId, isDeleted: false },
		});

		if (!ownerProfile) {
			throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
		}

		andConditions.push({
			isDeleted: false,
			room: { property: { ownerId: ownerProfile.id } },
		});
	}

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

	// managers hold OPERATE rights only: the payment ledger (deposit status,
	// bKash ids, gateway payloads) must never reach them (spec 17)
	const data =
		user.role === Role.PROPERTY_MANAGER
			? leases.map((lease) => ({
					...lease,
					application: lease.application
						? (() => {
								const { payment, ...applicationRest } = lease.application;
								return applicationRest;
							})()
						: lease.application,
				}))
			: leases;

	return {
		data,
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

	// an assigned manager may view leases on their properties (view-only)
	let isAssignedManager = false;
	if (user.role === Role.PROPERTY_MANAGER) {
		const assignment = await prisma.propertyManager.findFirst({
			where: {
				propertyId: lease.room.propertyId,
				manager: { userId: user.userId, isDeleted: false },
			},
		});
		isAssignedManager = Boolean(assignment);
	}

	if (!isTenant && !isOwner && !isAssignedManager && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this lease",
		);
	}

	// managers are view-only AND money-blind: strip the payment ledger
	// (spec 17 — no payment visibility for PROPERTY_MANAGER)
	if (user.role === Role.PROPERTY_MANAGER && lease.application) {
		const { payment, ...applicationRest } = lease.application;
		return { ...lease, application: applicationRest };
	}

	return lease;
};

// Terminate a lease (tenant / owner / admin). If the tenancy has not started
// yet, the booking deposit is refunded through bKash. Termination + refund run
// as a small saga: the payment is reserved first (PAID -> REFUND_PENDING) so
// exactly one caller can ever refund it, the bKash call happens outside any DB
// transaction (no locks held over HTTP), and the lease state change is a
// guarded write afterwards. A refund whose outcome is unknown stays
// REFUND_PENDING for manual reconciliation - it is never blindly retried.
const terminateLease = async (
	leaseId: string,
	reason: string,
	user: RequestUser,
) => {
	// 1. read + authorize (no writes yet) so we know what we are about to do
	const existingLease = await prisma.lease.findUnique({
		where: { id: leaseId },
		include: {
			tenantProfile: true,
			application: { include: { payment: true } },
			room: true,
		},
	});

	if (!existingLease || existingLease.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
	}

	const ownerProfile = existingLease.room.propertyId
		? await prisma.ownerProfile.findFirst({
				where: {
					properties: { some: { id: existingLease.room.propertyId } },
				},
			})
		: null;

	const isTenant = existingLease.tenantProfile.userId === user.userId;
	const isOwner = ownerProfile?.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isTenant && !isOwner && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to terminate this lease",
		);
	}

	if (existingLease.status !== LeaseStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Lease is already ${existingLease.status.toLowerCase()}`,
		);
	}

	const payment = existingLease.application?.payment;
	const leaseHasNotStarted = isAfter(
		new Date(existingLease.startDate),
		new Date(),
	);

	// a refund that never got a definitive outcome is waiting for
	// reconciliation - block termination (and any refund retry) until resolved
	if (payment?.status === PaymentStatus.REFUND_PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A deposit refund for this lease is already in progress. Please wait for it to be reconciled.",
		);
	}

	const shouldRefund =
		payment?.status === PaymentStatus.PAID && leaseHasNotStarted;

	let refundResult: Record<string, unknown> | null = null;

	if (shouldRefund && payment) {
		// SSLCommerz has no automated refund path here (managed transaction
		// API, out of scope): park the deposit in the admin refund queue -
		// support refunds it manually from the SSLCommerz merchant panel and
		// resolves it there - and stop the termination with clear guidance
		if (payment.gateway === PaymentGateway.SSLCOMMERZ) {
			const parked = await prisma.payment.updateMany({
				where: { id: payment.id, status: PaymentStatus.PAID },
				data: { status: PaymentStatus.REFUND_PENDING },
			});

			if (parked.count === 1) {
				await writeAuditLog({
					action: "REFUND_MANUAL_REQUIRED",
					entity: "Payment",
					entityId: payment.id,
					actorId: user.userId,
					actorEmail: user.email,
					actorRole: user.role,
					before: { status: PaymentStatus.PAID },
					after: {
						status: PaymentStatus.REFUND_PENDING,
						gateway: PaymentGateway.SSLCOMMERZ,
						reason,
					},
				});
			}

			throw new AppError(
				httpStatus.CONFLICT,
				"This deposit was paid via SSLCommerz, which has no automated refund. It has been queued for a manual refund by support - retry the termination once the refund is reconciled.",
			);
		}

		// 2. reserve the refund with a conditional write: the PAID ->
		// REFUND_PENDING flip can only ever succeed once, so concurrent
		// terminations can never double-refund the same deposit
		const reserved = await prisma.payment.updateMany({
			where: { id: payment.id, status: PaymentStatus.PAID },
			data: { status: PaymentStatus.REFUND_PENDING },
		});

		if (reserved.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Deposit refund already initiated by another request",
			);
		}

		// 3. move the money OUTSIDE any transaction - no DB locks are held
		// while the gateway call is in flight (dispatch on the payment's
		// gateway; the reservation pattern is shared)
		try {
			if (payment.gateway === PaymentGateway.STRIPE) {
				// refunds a Stripe Checkout charge through its payment intent;
				// ledger amount recorded, provider payload kept raw
				const refund = await refundStripePayment({
					sessionId: payment.bKashPaymentId as string,
					paymentIntent: payment.bKashTrxId || undefined,
					amount: payment.amount.toString(),
					reason,
				});

				refundResult = {
					refundTrxID: refund.id,
					completedTime: new Date().toISOString(),
					provider: "STRIPE",
					...refund,
				} as any;
			} else {
				refundResult = await refundBkashPayment({
					paymentID: payment.bKashPaymentId || undefined,
					trxID: payment.bKashTrxId || undefined,
					amount: payment.amount.toString(),
					sku: "Lease Termination (Deposit Refund)",
					reason: reason,
				});
			}
		} catch (error) {
			if (
				error instanceof BkashAmbiguousError ||
				error instanceof ProviderAmbiguousError
			) {
				// the refund may have gone through: keep REFUND_PENDING so it is
				// reconciled manually - retrying here could double-refund
				await writeAuditLog({
					action: "REFUND_OUTCOME_UNKNOWN",
					entity: "Payment",
					entityId: payment.id,
					actorId: user.userId,
					actorEmail: user.email,
					actorRole: user.role,
					before: { status: PaymentStatus.PAID },
					after: {
						status: PaymentStatus.REFUND_PENDING,
						reason,
						gateway: payment.gateway,
					},
				});

				const providerName =
					payment.gateway === PaymentGateway.STRIPE ? "Stripe" : "bKash";

				throw new AppError(
					httpStatus.BAD_GATEWAY,
					`Lease termination aborted: ${providerName} did not confirm the refund outcome. The refund is held for reconciliation and the lease stays active.`,
				);
			}

			// definitive gateway rejection: release the reservation so the whole
			// termination stays retryable once the issue is resolved
			await prisma.payment.updateMany({
				where: { id: payment.id, status: PaymentStatus.REFUND_PENDING },
				data: { status: PaymentStatus.PAID },
			});

			throw error;
		}

		// 4. record the refund before touching the lease: even if the
		// termination below fails, a recorded REFUNDED payment makes the retry
		// path self-healing (a retry simply terminates without refunding again)
		await prisma.$transaction(async (tx) => {
			await tx.payment.updateMany({
				where: { id: payment.id, status: PaymentStatus.REFUND_PENDING },
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

			await writeAuditLog(
				{
					action: "PAYMENT_REFUNDED",
					entity: "Payment",
					entityId: payment.id,
					actorId: user.userId,
					actorEmail: user.email,
					actorRole: user.role,
					after: {
						status: PaymentStatus.REFUNDED,
						amount: payment.amount.toString(),
						reason,
					},
				},
				tx,
			);
		});
	}

	// 5. guarded transaction: only one caller can win the ACTIVE lease
	const updatedLease = await prisma.$transaction(async (tx) => {
		const leaseUpdate = await tx.lease.updateMany({
			where: { id: leaseId, status: LeaseStatus.ACTIVE },
			data: {
				status: LeaseStatus.TERMINATED,
				terminationReason: reason,
				terminatedBy: user.userId,
				terminatedAt: new Date(),
			},
		});

		if (leaseUpdate.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Lease is no longer active. Termination aborted.",
			);
		}

		const updated = await tx.lease.findUniqueOrThrow({
			where: { id: leaseId },
		});

		// release the occupied bed (if the room still counts it)
		const room = await tx.room.findUnique({
			where: { id: existingLease.roomId },
		});
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
				leaseId,
				status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.PROCESSING] },
			},
			data: { status: InvoiceStatus.CANCELLED },
		});

		// audit trail commits atomically with the termination
		await writeAuditLog(
			{
				action: "LEASE_TERMINATED",
				entity: "Lease",
				entityId: leaseId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: existingLease.status },
				after: { status: LeaseStatus.TERMINATED, reason },
			},
			tx,
		);

		// P3: close live roommate memberships with the lease — same
		// transaction, so no member is ever orphaned by a termination
		const liveMemberships = await tx.roommateMembership.findMany({
			where: {
				leaseId,
				status: { in: [MembershipStatus.PENDING, MembershipStatus.ACTIVE] },
			},
			select: {
				id: true,
				status: true,
				tenantProfile: { select: { userId: true } },
			},
		});

		if (liveMemberships.length > 0) {
			await tx.roommateMembership.updateMany({
				where: {
					leaseId,
					status: { in: [MembershipStatus.PENDING, MembershipStatus.ACTIVE] },
				},
				data: {
					status: MembershipStatus.REMOVED,
					removedAt: new Date(),
					removedBy: user.userId,
					removalReason: "Lease terminated",
				},
			});

			for (const membership of liveMemberships) {
				await writeAuditLog(
					{
						action: "MEMBERSHIP_REMOVED",
						entity: "RoommateMembership",
						entityId: membership.id,
						actorId: user.userId,
						actorEmail: user.email,
						actorRole: user.role,
						before: { status: membership.status },
						after: {
							status: MembershipStatus.REMOVED,
							reason: "Lease terminated",
						},
					},
					tx,
				);
			}
		}

		return {
			updated,
			memberUserIds: liveMemberships.map((m) => m.tenantProfile.userId),
		};
	});

	const { updated: finalLease, memberUserIds } = updatedLease;
	const { tenantProfile } = existingLease;

	// the termination is already committed: side-effect failures must not
	// turn it into a 500, and one failing side effect must not skip the other
	try {
		await createNotification({
			userId: tenantProfile.userId,
			type: NotificationType.LEASE,
			title: "Lease terminated 📄",
			message: `Your lease for the room has been terminated. Reason: ${reason}`,
			data: { leaseId },
		});
	} catch (error) {
		console.log("Lease termination notification failed:", error);
	}

	try {
		await sendTemplateEmail({
			to: tenantProfile.email,
			subject: "Your Lease Has Been Terminated - Housing & Roommate",
			template: "lease-terminated",
			data: {
				name: tenantProfile.name,
				reason,
				refunded: refundResult
					? "A full deposit refund was issued to your bKash account."
					: "No refund was applicable.",
			},
		});
	} catch (error) {
		console.log("Lease termination email failed:", error);
	}

	// roommate members lose their arrangement with the lease (fail-soft)
	for (const memberUserId of memberUserIds) {
		try {
			await createNotification({
				userId: memberUserId,
				type: NotificationType.ROOMMATE,
				title: "Roommate membership ended 🚪",
				message:
					"The lease for your room was terminated, so your roommate membership has ended.",
				data: { leaseId },
			});
		} catch (error) {
			console.log("Lease termination member notification failed:", error);
		}
	}

	// the property owner loses a tenant — notify unless they are the actor
	if (ownerProfile && ownerProfile.userId !== user.userId) {
		try {
			await createNotification({
				userId: ownerProfile.userId,
				type: NotificationType.LEASE,
				title: "Lease terminated 📄",
				message: `The lease for "${existingLease.room.name}" held by ${tenantProfile.name} was terminated. Reason: ${reason}`,
				data: { leaseId },
			});
		} catch (error) {
			console.log("Lease termination owner notification failed:", error);
		}
	}

	return {
		lease: finalLease,
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
		(
			await prisma.ownerProfile.findFirst({
				where: { userId: user.userId, isDeleted: false },
			})
		)?.id;
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

	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
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
