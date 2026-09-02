import httpStatus from "http-status";
import {
	ApplicationStatus,
	NotificationType,
	PaymentPurpose,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import { isBefore } from "date-fns";
import type { IQuery } from "../../interfaces";
import type { ApplicationWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { createBkashPayment } from "../../lib/bKash";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { writeAuditLog } from "../../utils/audit";
import type {
	IApplyForRoomPayload,
	IReviewApplicationPayload,
} from "./application.interface";

const cancellableApplicationStatuses: ApplicationStatus[] = [
	ApplicationStatus.PENDING,
	ApplicationStatus.APPROVED,
];

const nonRefundablePaymentStatuses: PaymentStatus[] = [
	PaymentStatus.PROCESSING,
	PaymentStatus.PAID,
	PaymentStatus.REFUNDED,
];

// Number of OTHER approved-but-unpaid applications occupying the same room.
// Used to prevent an owner from over-approving beyond the available beds.
const countProspectiveBeds = async (
	roomId: string,
	excludeApplicationId?: string,
) => {
	return prisma.application.count({
		where: {
			roomId,
			isDeleted: false,
			status: ApplicationStatus.APPROVED,
			lease: { is: null },
			id: excludeApplicationId ? { not: excludeApplicationId } : undefined,
		},
	});
};

// TENANT applies for a room (PENDING until the owner reviews it)
const applyForRoom = async (
	payload: IApplyForRoomPayload,
	user: RequestUser,
) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const tenantProfile = await tx.tenantProfile.findUnique({
			where: { userId: user.userId },
		});

		if (!tenantProfile) {
			throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
		}

		const room = await tx.room.findFirst({
			where: { id: payload.roomId, isDeleted: false, isPublished: true },
		});

		if (!room) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}

		// the room must still have a spare bed
		if (room.occupiedBeds >= room.bedCount) {
			throw new AppError(httpStatus.CONFLICT, "Room is already fully occupied");
		}

		// cannot move in before the room becomes available
		if (
			room.availableFrom &&
			isBefore(new Date(payload.moveInDate), room.availableFrom)
		) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Room is only available from ${room.availableFrom.toDateString()}`,
			);
		}

		// lease term must satisfy the owner's minimum
		if (payload.leaseMonths < room.minLeaseMonths) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				`Minimum lease term for this room is ${room.minLeaseMonths} month(s)`,
			);
		}

		// a tenant can hold only one live application per room
		const duplicateApplication = await tx.application.findFirst({
			where: {
				tenantProfileId: tenantProfile.id,
				roomId: room.id,
				isDeleted: false,
				status: { in: [ApplicationStatus.PENDING, ApplicationStatus.APPROVED] },
			},
		});

		if (duplicateApplication) {
			throw new AppError(
				httpStatus.CONFLICT,
				"You already have a pending or approved application for this room",
			);
		}

		// if the tenant applies together with a roommate pair, validate the pair
		if (payload.roommatePairId) {
			const pair = await tx.roommatePair.findUnique({
				where: { id: payload.roommatePairId },
			});

			const isPartOfPair =
				pair &&
				(pair.tenantAId === tenantProfile.id ||
					pair.tenantBId === tenantProfile.id);

			if (!isPartOfPair) {
				throw new AppError(
					httpStatus.BAD_REQUEST,
					"Roommate pair is invalid for this tenant",
				);
			}
		}

		const application = await tx.application.create({
			data: {
				tenantProfileId: tenantProfile.id,
				roomId: room.id,
				moveInDate: new Date(payload.moveInDate),
				leaseMonths: payload.leaseMonths,
				roommatePairId: payload.roommatePairId,
				message: payload.message,
			},
		});

		return { application, room };
	});

	// notify the room owner that a new application arrived
	const property = await prisma.property.findUnique({
		where: { id: transactionResult.room.propertyId },
		include: { owner: true },
	});

	if (property?.owner) {
		await createNotification({
			userId: property.owner.userId,
			type: NotificationType.APPLICATION,
			title: "New rental application 📝",
			message: `${user.name} applied for "${transactionResult.room.name}" starting ${new Date(payload.moveInDate).toDateString()}.`,
			data: {
				applicationId: transactionResult.application.id,
				roomId: transactionResult.room.id,
			},
		});
	}

	return transactionResult.application;
};

// TENANT: my applications
const getMyApplications = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: ApplicationWhereInput[] = [
		{ tenantProfileId: tenantProfile.id, isDeleted: false },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const applications = await prisma.application.findMany({
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
			lease: true,
			payment: true,
		},
	});

	const total = await prisma.application.count({
		where: { AND: andConditions },
	});

	return {
		data: applications,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER: applications on their rooms
const getOwnerApplications = async (user: RequestUser, query: IQuery) => {
	const ownerProfile = await prisma.ownerProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: ApplicationWhereInput[] = [
		{ isDeleted: false, room: { property: { ownerId: ownerProfile.id } } },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.roomId) {
		andConditions.push({ roomId: query.roomId });
	}

	const applications = await prisma.application.findMany({
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
					occupation: true,
					user: { select: { imageUrl: true } },
				},
			},
			room: {
				select: { id: true, name: true, monthlyRent: true },
			},
			lease: true,
			payment: true,
		},
	});

	const total = await prisma.application.count({
		where: { AND: andConditions },
	});

	return {
		data: applications,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Anyone allowed to see an application (tenant owner, room owner, admin)
const getApplicationDetail = async (
	applicationId: string,
	user: RequestUser,
) => {
	const application = await prisma.application.findUnique({
		where: { id: applicationId },
		include: {
			tenantProfile: {
				include: {
					user: { select: { id: true, name: true, imageUrl: true } },
				},
			},
			room: {
				include: {
					property: {
						include: {
							owner: {
								select: {
									id: true,
									userId: true,
									name: true,
									companyName: true,
								},
							},
						},
					},
				},
			},
			lease: true,
			payment: true,
			roommatePair: {
				include: {
					tenantA: { select: { id: true, name: true } },
					tenantB: { select: { id: true, name: true } },
				},
			},
		},
	});

	if (!application || application.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Application not found");
	}

	const isTenantOfApplication =
		application.tenantProfile.userId === user.userId;
	const isOwnerOfRoom = application.room.property.owner.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isTenantOfApplication && !isOwnerOfRoom && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this application",
		);
	}

	return application;
};

// OWNER: approve or reject an application
const reviewApplication = async (
	applicationId: string,
	payload: IReviewApplicationPayload,
	user: RequestUser,
) => {
	const ownerProfile = await prisma.ownerProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const transactionResult = await prisma.$transaction(async (tx) => {
		const application = await tx.application.findUnique({
			where: { id: applicationId },
			include: { room: { include: { property: true } } },
		});

		if (!application || application.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Application not found");
		}

		// only the owner of the property may review
		if (application.room.property.ownerId !== ownerProfile.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not the owner of this room",
			);
		}

		if (application.status !== ApplicationStatus.PENDING) {
			throw new AppError(
				httpStatus.CONFLICT,
				`Application has already been ${application.status.toLowerCase()}`,
			);
		}

		if (payload.status === "REJECTED" && !payload.rejectionReason) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Rejection reason is required when rejecting an application",
			);
		}

		// capacity guard: do not approve more beds than the room offers
		if (payload.status === "APPROVED") {
			const prospectiveBeds =
				application.room.occupiedBeds +
				(await countProspectiveBeds(application.roomId, application.id));

			if (prospectiveBeds >= application.room.bedCount) {
				throw new AppError(
					httpStatus.CONFLICT,
					"This room has no available bed left for another applicant",
				);
			}
		}

		const updatedApplication = await tx.application.update({
			where: { id: applicationId },
			data: {
				status: payload.status as ApplicationStatus,
				rejectionReason:
					payload.status === "REJECTED" ? payload.rejectionReason : null,
				reviewedBy: user.userId,
				reviewedAt: new Date(),
			},
		});

		return { updatedApplication, application };
	});

	const { updatedApplication, application } = transactionResult;
	const isApproved = payload.status === "APPROVED";

	// audit trail of the decision
	await writeAuditLog({
		action: isApproved ? "APPLICATION_APPROVED" : "APPLICATION_REJECTED",
		entity: "Application",
		entityId: applicationId,
		actorId: user.userId,
		actorEmail: user.email,
		actorRole: user.role,
		before: { status: application.status },
		after: { status: payload.status },
	});

	// notify + email the tenant
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { id: application.tenantProfileId },
	});

	if (tenantProfile) {
		await sendTemplateEmail({
			to: tenantProfile.email,
			subject: isApproved
				? "Your Application Was Approved!"
				: "Your Application Was Rejected",
			template: isApproved ? "application-approved" : "application-rejected",
			data: {
				name: tenantProfile.name,
				roomName: application.room.name,
				reason: application.rejectionReason,
			},
		});

		await createNotification({
			userId: tenantProfile.userId,
			type: NotificationType.APPLICATION,
			title: isApproved ? "Application approved 🎉" : "Application rejected",
			message: isApproved
				? `Your application for "${application.room.name}" was approved. Pay the booking deposit to lock the room!`
				: `Your application for "${application.room.name}" was rejected. Reason: ${application.rejectionReason || "not provided"}`,
			data: { applicationId, roomId: application.roomId },
		});
	}

	return updatedApplication;
};

// TENANT: pay the booking deposit for an APPROVED application (bKash)
const payDeposit = async (applicationId: string, user: RequestUser) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const application = await prisma.application.findUnique({
		where: { id: applicationId },
		include: { room: true },
	});

	if (!application || application.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Application not found");
	}

	if (application.tenantProfileId !== tenantProfile.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only pay for your own applications",
		);
	}

	if (application.status !== ApplicationStatus.APPROVED) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Application must be approved before you can pay the booking deposit",
		);
	}

	// already moved in?
	const existingLease = await prisma.lease.findUnique({
		where: { applicationId: application.id },
	});

	if (existingLease) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This application already has a lease",
		);
	}

	// existing paid/processing payment should not be duplicated
	const existingPayment = await prisma.payment.findUnique({
		where: { applicationId: application.id },
	});

	if (
		existingPayment &&
		nonRefundablePaymentStatuses.includes(existingPayment.status)
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A payment for this application is already in progress or completed",
		);
	}

	// the deposit = the room's booking deposit (fallback: one month rent)
	const amount = application.room.bookingDeposit.greaterThan(0)
		? application.room.bookingDeposit.toString()
		: application.room.monthlyRent.toString();

	const bKashCreatePaymentResult = await createBkashPayment({
		amount,
		payerReference: user.email,
		merchantInvoiceNumber: application.id,
		callbackPath: "/payment/callback",
	});

	// create the payment row (or refresh an earlier failed attempt)
	const payment = await prisma.payment.upsert({
		where: { applicationId: application.id },
		update: {
			status: PaymentStatus.PROCESSING,
			purpose: PaymentPurpose.DEPOSIT,
			amount,
			merchantInvoiceNumber: application.id,
			bKashPaymentId: bKashCreatePaymentResult.paymentID,
			payerReference: user.email,
			gatwayResponse: bKashCreatePaymentResult,
		},
		create: {
			status: PaymentStatus.PROCESSING,
			purpose: PaymentPurpose.DEPOSIT,
			amount,
			merchantInvoiceNumber: application.id,
			bKashPaymentId: bKashCreatePaymentResult.paymentID,
			payerReference: user.email,
			gatwayResponse: bKashCreatePaymentResult,
			applicationId: application.id,
		},
	});

	return {
		payment,
		paymentUrl: bKashCreatePaymentResult.bkashURL,
	};
};

// TENANT/ADMIN: cancel a live application (before it turns into a lease)
const cancelApplication = async (applicationId: string, user: RequestUser) => {
	const transactionResult = await prisma.$transaction(async (tx) => {
		const application = await tx.application.findUnique({
			where: { id: applicationId },
			include: { tenantProfile: true },
		});

		if (!application || application.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Application not found");
		}

		const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;
		if (!isAdmin && application.tenantProfile.userId !== user.userId) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You cannot cancel this application",
			);
		}

		if (!cancellableApplicationStatuses.includes(application.status)) {
			throw new AppError(
				httpStatus.CONFLICT,
				`Application cannot be cancelled in ${application.status.toLowerCase()} status`,
			);
		}

		const payment = await tx.payment.findUnique({
			where: { applicationId: application.id },
		});

		if (payment && nonRefundablePaymentStatuses.includes(payment.status)) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Application already has a paid/processing payment. Please contact the owner instead.",
			);
		}

		const updatedApplication = await tx.application.update({
			where: { id: applicationId },
			data: {
				status: ApplicationStatus.CANCELLED,
				reviewedBy: isAdmin ? user.userId : application.tenantProfile.userId,
				reviewedAt: new Date(),
			},
		});

		return updatedApplication;
	});

	return transactionResult;
};

export const ApplicationServices = {
	applyForRoom,
	getMyApplications,
	getOwnerApplications,
	getApplicationDetail,
	reviewApplication,
	payDeposit,
	cancelApplication,
};
