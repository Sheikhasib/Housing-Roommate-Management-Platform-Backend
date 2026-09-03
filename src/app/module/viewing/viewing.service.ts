import httpStatus from "http-status";
import {
	NotificationType,
	ViewingStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { ViewingRequestWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { createNotification } from "../../utils/notification";
import type {
	ICreateViewingRequestPayload,
	IUpdateViewingStatusPayload,
} from "./viewing.interface";

// TENANT: request a property viewing for a room
const createViewingRequest = async (
	payload: ICreateViewingRequestPayload,
	user: RequestUser,
) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const room = await prisma.room.findFirst({
		where: {
			id: payload.roomId,
			isDeleted: false,
			isPublished: true,
			property: { isDeleted: false },
		},
		include: { property: { include: { owner: true } } },
	});

	if (!room) {
		throw new AppError(httpStatus.NOT_FOUND, "Room not found");
	}

	// a tenant cannot request a viewing twice for the same room while pending
	const existingRequest = await prisma.viewingRequest.findFirst({
		where: {
			tenantProfileId: tenantProfile.id,
			roomId: room.id,
			status: ViewingStatus.PENDING,
			isDeleted: false,
		},
	});

	if (existingRequest) {
		throw new AppError(
			httpStatus.CONFLICT,
			"You already have a pending viewing request for this room",
		);
	}

	const viewingRequest = await prisma.viewingRequest.create({
		data: {
			tenantProfileId: tenantProfile.id,
			roomId: room.id,
			preferredDate: new Date(payload.preferredDate),
			timeSlot: payload.timeSlot,
			message: payload.message,
		},
	});

	// notify the property owner
	await createNotification({
		userId: room.property.owner.userId,
		type: NotificationType.VIEWING,
		title: "New viewing request 🏠",
		message: `${tenantProfile.name} requested to view "${room.name}" on ${new Date(payload.preferredDate).toDateString()}.`,
		data: { viewingRequestId: viewingRequest.id, roomId: room.id },
	});

	return viewingRequest;
};

// TENANT: my viewing requests
const getMyViewingRequests = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: ViewingRequestWhereInput[] = [
		{ tenantProfileId: tenantProfile.id, isDeleted: false },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const requests = await prisma.viewingRequest.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			room: {
				include: {
					property: {
						select: { id: true, title: true, city: true, area: true },
					},
				},
			},
		},
	});

	const total = await prisma.viewingRequest.count({
		where: { AND: andConditions },
	});

	return {
		data: requests,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER: viewing requests for rooms of their properties
const getOwnerViewingRequests = async (user: RequestUser, query: IQuery) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: ViewingRequestWhereInput[] = [
		{ isDeleted: false, room: { property: { ownerId: ownerProfile.id } } },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.roomId) {
		andConditions.push({ roomId: query.roomId });
	}

	const requests = await prisma.viewingRequest.findMany({
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
			room: { select: { id: true, name: true, monthlyRent: true } },
		},
	});

	const total = await prisma.viewingRequest.count({
		where: { AND: andConditions },
	});

	return {
		data: requests,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER/ADMIN: approve/reject/complete a viewing request
const updateViewingStatus = async (
	requestId: string,
	payload: IUpdateViewingStatusPayload,
	user: RequestUser,
) => {
	const viewingRequest = await prisma.viewingRequest.findUnique({
		where: { id: requestId },
		include: {
			room: { include: { property: true } },
			tenantProfile: true,
		},
	});

	if (!viewingRequest || viewingRequest.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Viewing request not found");
	}

	// the owner of the room decides (admins moderate)
	const isOwnerOfRoom =
		user.role === "OWNER" &&
		viewingRequest.room.property.ownerId ===
			(
				await prisma.ownerProfile.findFirst({
					where: { userId: user.userId, isDeleted: false },
				})
			)?.id;

	if (user.role === "TENANT") {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to update viewing request status",
		);
	}

	if (user.role === "OWNER" && !isOwnerOfRoom) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not the owner of this room",
		);
	}

	// guard the allowed lifecycle transitions (a viewing can only complete
	// after it has been approved and actually took place)
	const allowedTransitions: Record<ViewingStatus, ViewingStatus[]> = {
		[ViewingStatus.PENDING]: [ViewingStatus.APPROVED, ViewingStatus.REJECTED],
		[ViewingStatus.APPROVED]: [ViewingStatus.COMPLETED],
		[ViewingStatus.REJECTED]: [],
		[ViewingStatus.COMPLETED]: [],
		[ViewingStatus.CANCELLED]: [],
	};

	if (viewingRequest.status === payload.status) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Viewing request is already ${payload.status.toLowerCase()}`,
		);
	}

	if (
		!(allowedTransitions[viewingRequest.status] || []).includes(payload.status)
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Cannot move viewing request from ${viewingRequest.status.toLowerCase()} to ${payload.status.toLowerCase()}`,
		);
	}

	if (payload.status === ViewingStatus.REJECTED && !payload.rejectionReason) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Rejection reason is required when rejecting a viewing request",
		);
	}

	const updatedRequest = await prisma.$transaction(async (tx) => {
		// conditional write: only applies while the status is still the one the
		// transition was validated against (guards the read-then-write race
		// against a concurrent owner decision or tenant cancellation)
		const updatedCount = await tx.viewingRequest.updateMany({
			where: { id: requestId, status: viewingRequest.status },
			data: {
				status: payload.status as ViewingStatus,
				rejectionReason:
					payload.status === ViewingStatus.REJECTED
						? payload.rejectionReason
						: null,
				scheduledDateTime:
					payload.status === ViewingStatus.APPROVED
						? payload.scheduledDateTime
							? new Date(payload.scheduledDateTime)
							: viewingRequest.preferredDate
						: undefined,
			},
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Viewing request was updated by someone else. Please refresh and try again.",
			);
		}

		const updated = await tx.viewingRequest.findUniqueOrThrow({
			where: { id: requestId },
		});

		await writeAuditLog(
			{
				action: "VIEWING_STATUS_UPDATED",
				entity: "ViewingRequest",
				entityId: requestId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: viewingRequest.status },
				after: { status: payload.status },
			},
			tx,
		);

		return updated;
	});

	// notify the tenant about the decision
	await createNotification({
		userId: viewingRequest.tenantProfile.userId,
		type: NotificationType.VIEWING,
		title: `Viewing request ${payload.status.toLowerCase()} 📅`,
		message:
			payload.status === ViewingStatus.APPROVED
				? `Your viewing request for "${viewingRequest.room.name}" was approved.`
				: payload.status === ViewingStatus.REJECTED
					? `Your viewing request was rejected. Reason: ${payload.rejectionReason}`
					: "Your viewing has been completed. We hope you liked the room!",
		data: { viewingRequestId: requestId, roomId: viewingRequest.roomId },
	});

	return updatedRequest;
};

// TENANT: cancel my own pending/approved viewing request
const cancelViewingRequest = async (requestId: string, user: RequestUser) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const viewingRequest = await prisma.viewingRequest.findFirst({
		where: {
			id: requestId,
			tenantProfileId: tenantProfile.id,
			isDeleted: false,
		},
		include: {
			room: { include: { property: { include: { owner: true } } } },
		},
	});

	if (!viewingRequest) {
		throw new AppError(httpStatus.NOT_FOUND, "Viewing request not found");
	}

	const cancellableStatuses: ViewingStatus[] = [
		ViewingStatus.PENDING,
		ViewingStatus.APPROVED,
	];

	if (!cancellableStatuses.includes(viewingRequest.status)) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Viewing request is already ${viewingRequest.status.toLowerCase()}`,
		);
	}

	const updatedRequest = await prisma.$transaction(async (tx) => {
		// conditional write: only a still pending/approved request can be
		// cancelled (guards against the owner deciding concurrently)
		const updatedCount = await tx.viewingRequest.updateMany({
			where: {
				id: requestId,
				status: { in: cancellableStatuses },
			},
			data: { status: ViewingStatus.CANCELLED },
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Viewing request is no longer cancellable. Please refresh and try again.",
			);
		}

		const updated = await tx.viewingRequest.findUniqueOrThrow({
			where: { id: requestId },
		});

		await writeAuditLog(
			{
				action: "VIEWING_CANCELLED",
				entity: "ViewingRequest",
				entityId: requestId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: viewingRequest.status },
				after: { status: ViewingStatus.CANCELLED },
			},
			tx,
		);

		return updated;
	});

	// the owner loses a planned visit - let them know
	await createNotification({
		userId: viewingRequest.room.property.owner.userId,
		type: NotificationType.VIEWING,
		title: "Viewing request cancelled 📅",
		message: `${tenantProfile.name} cancelled their viewing request for "${viewingRequest.room.name}".`,
		data: { viewingRequestId: requestId, roomId: viewingRequest.roomId },
	});

	return updatedRequest;
};

export const ViewingServices = {
	createViewingRequest,
	getMyViewingRequests,
	getOwnerViewingRequests,
	updateViewingStatus,
	cancelViewingRequest,
};
