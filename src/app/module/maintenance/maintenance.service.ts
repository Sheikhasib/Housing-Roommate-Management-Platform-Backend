import httpStatus from "http-status";
import {
	LeaseStatus,
	MaintenanceStatus,
	NotificationType,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { MaintenanceRequestWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { createNotification } from "../../utils/notification";
import { sendTemplateEmail } from "../../utils/email";
import { uploadFileToCloudinary } from "../../utils/cloudinaryUpload";
import type {
	ICreateMaintenanceRequestPayload,
	IUpdateMaintenanceStatusPayload,
} from "./maintenance.interface";

// TENANT reports an issue with a room they are actively renting
const createMaintenanceRequest = async (
	payload: ICreateMaintenanceRequestPayload,
	user: RequestUser,
) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	// only tenants with an active lease on the room may report maintenance
	const activeLease = await prisma.lease.findFirst({
		where: {
			roomId: payload.roomId,
			tenantProfileId: tenantProfile.id,
			status: LeaseStatus.ACTIVE,
			isDeleted: false,
		},
		include: { room: { include: { property: { include: { owner: true } } } } },
	});

	if (!activeLease) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You need an active lease on this room to report maintenance",
		);
	}

	const maintenanceRequest = await prisma.maintenanceRequest.create({
		data: {
			tenantProfileId: tenantProfile.id,
			roomId: payload.roomId,
			leaseId: activeLease.id,
			category: payload.category,
			priority: payload.priority,
			title: payload.title,
			description: payload.description,
		},
	});

	// notify the property owner
	await createNotification({
		userId: activeLease.room.property.owner.userId,
		type: NotificationType.MAINTENANCE,
		title: "New maintenance request 🔧",
		message: `${tenantProfile.name} reported: ${payload.title}`,
		data: {
			maintenanceRequestId: maintenanceRequest.id,
			roomId: payload.roomId,
		},
	});

	return maintenanceRequest;
};

// TENANT: my maintenance requests
const getMyMaintenanceRequests = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: MaintenanceRequestWhereInput[] = [
		{ tenantProfileId: tenantProfile.id, isDeleted: false },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const requests = await prisma.maintenanceRequest.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			room: {
				include: {
					property: { select: { id: true, title: true, city: true } },
				},
			},
		},
	});

	const total = await prisma.maintenanceRequest.count({
		where: { AND: andConditions },
	});

	return {
		data: requests,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER: maintenance requests on their rooms
const getOwnerMaintenanceRequests = async (
	user: RequestUser,
	query: IQuery,
) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: MaintenanceRequestWhereInput[] = [
		{ isDeleted: false, room: { property: { ownerId: ownerProfile.id } } },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.roomId) {
		andConditions.push({ roomId: query.roomId });
	}

	const requests = await prisma.maintenanceRequest.findMany({
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
			room: { select: { id: true, name: true } },
		},
	});

	const total = await prisma.maintenanceRequest.count({
		where: { AND: andConditions },
	});

	return {
		data: requests,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER/ADMIN: move the request through its lifecycle
const updateMaintenanceStatus = async (
	requestId: string,
	payload: IUpdateMaintenanceStatusPayload,
	user: RequestUser,
) => {
	const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
		where: { id: requestId },
		include: {
			room: { include: { property: { include: { owner: true } } } },
			tenantProfile: true,
		},
	});

	if (!maintenanceRequest || maintenanceRequest.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Maintenance request not found");
	}

	const isOwnerOfRoom =
		maintenanceRequest.room.property.owner.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isOwnerOfRoom && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to update this maintenance request",
		);
	}

	const current = maintenanceRequest.status;
	const next = payload.status;

	// guard the allowed lifecycle transitions
	const allowedTransitions: Record<MaintenanceStatus, MaintenanceStatus[]> = {
		[MaintenanceStatus.OPEN]: [
			MaintenanceStatus.ASSIGNED,
			MaintenanceStatus.IN_PROGRESS,
			MaintenanceStatus.RESOLVED,
			MaintenanceStatus.CLOSED,
		],
		[MaintenanceStatus.ASSIGNED]: [
			MaintenanceStatus.IN_PROGRESS,
			MaintenanceStatus.RESOLVED,
			MaintenanceStatus.CLOSED,
		],
		[MaintenanceStatus.IN_PROGRESS]: [
			MaintenanceStatus.RESOLVED,
			MaintenanceStatus.CLOSED,
		],
		[MaintenanceStatus.RESOLVED]: [MaintenanceStatus.CLOSED],
		[MaintenanceStatus.CLOSED]: [],
	};

	const validTransition = (allowedTransitions[current] || []).includes(next);

	if (!validTransition) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			`Cannot move request from ${current.toLowerCase()} to ${next.toLowerCase()}`,
		);
	}

	if (
		next === MaintenanceStatus.RESOLVED ||
		next === MaintenanceStatus.CLOSED
	) {
		if (next === MaintenanceStatus.RESOLVED && !payload.resolutionNotes) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Resolution notes are required when resolving a request",
			);
		}
	}

	// when assigning, the assignee must be a real, non-deleted staff user
	if (next === MaintenanceStatus.ASSIGNED && payload.assignedTo) {
		const assignee = await prisma.user.findFirst({
			where: {
				id: payload.assignedTo,
				isDeleted: false,
				status: { not: UserStatus.BLOCKED },
				role: { in: [Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN] },
			},
		});

		if (!assignee) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"assignedTo must reference an existing staff user",
			);
		}
	}

	const updatedRequest = await prisma.$transaction(async (tx) => {
		const updated = await tx.maintenanceRequest.update({
			where: { id: requestId },
			data: {
				status: next,
				assignedTo:
					next === MaintenanceStatus.ASSIGNED
						? payload.assignedTo || user.userId
						: maintenanceRequest.assignedTo,
				assignedAt:
					next === MaintenanceStatus.ASSIGNED
						? new Date()
						: maintenanceRequest.assignedAt,
				resolutionNotes:
					next === MaintenanceStatus.RESOLVED ||
					next === MaintenanceStatus.CLOSED
						? payload.resolutionNotes || maintenanceRequest.resolutionNotes
						: maintenanceRequest.resolutionNotes,
				resolvedAt:
					next === MaintenanceStatus.RESOLVED
						? new Date()
						: maintenanceRequest.resolvedAt,
			},
		});

		await writeAuditLog(
			{
				action: "MAINTENANCE_STATUS_UPDATED",
				entity: "MaintenanceRequest",
				entityId: requestId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: current },
				after: { status: next, assignedTo: updated.assignedTo },
			},
			tx,
		);

		return updated;
	});

	// notify the tenant who raised it
	await createNotification({
		userId: maintenanceRequest.tenantProfile.userId,
		type: NotificationType.MAINTENANCE,
		title: `Maintenance ${next.toLowerCase().replace("_", " ")} 🔧`,
		message: `Your maintenance request "${maintenanceRequest.title}" is now ${next.toLowerCase().replace("_", " ")}.`,
		data: {
			maintenanceRequestId: requestId,
			roomId: maintenanceRequest.roomId,
		},
	});

	await sendTemplateEmail({
		to: maintenanceRequest.tenantProfile.email,
		subject: `Maintenance Request ${next} - Housing & Roommate`,
		template: "maintenance-status",
		data: {
			name: maintenanceRequest.tenantProfile.name,
			title: maintenanceRequest.title,
			status: next,
			resolutionNotes: payload.resolutionNotes || "N/A",
		},
	});

	return updatedRequest;
};

// Add a photo to the maintenance request
const uploadMaintenanceImage = async (
	requestId: string,
	buffer: Buffer,
	user: RequestUser,
) => {
	const maintenanceRequest = await prisma.maintenanceRequest.findUnique({
		where: { id: requestId },
		include: {
			room: { include: { property: true } },
			tenantProfile: true,
		},
	});

	if (!maintenanceRequest || maintenanceRequest.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Maintenance request not found");
	}

	const isTenant = maintenanceRequest.tenantProfile.userId === user.userId;
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});
	const isOwner = maintenanceRequest.room.property.ownerId === ownerProfile?.id;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	if (!isTenant && !isOwner && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to attach an image to this request",
		);
	}

	const uploadResult = await uploadFileToCloudinary(
		buffer,
		"maintenance-images",
	);

	return prisma.maintenanceRequest.update({
		where: { id: requestId },
		data: {
			imageUrl: uploadResult.secure_url,
			imagePublicId: uploadResult.public_id,
		},
	});
};

export const MaintenanceServices = {
	createMaintenanceRequest,
	getMyMaintenanceRequests,
	getOwnerMaintenanceRequests,
	updateMaintenanceStatus,
	uploadMaintenanceImage,
};
