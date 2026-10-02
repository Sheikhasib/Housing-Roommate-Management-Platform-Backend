import httpStatus from "http-status";
import { LeaseStatus, Role, RoomStatus } from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { RoomWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";
import { getVerifiedOwnerProfile } from "../../utils/ownerGuard";
import {
	propertyManagerScope,
	resolvePropertyRole,
} from "../../utils/propertyAccess";
import { recalculateRoomStatus } from "../../utils/roomStatus";
import type {
	ICreateRoomPayload,
	IPropertyAvailabilityResponse,
	IRoomAvailability,
	IRoomAvailabilityRoom,
	ISetRoomAvailabilityPayload,
	IUpdateRoomPayload,
} from "./room.interface";

type TImage = { url: string; publicId: string };

// On-the-fly vacancy math shared by every read surface. All inputs are live
// rows (bedCount/occupiedBeds are maintained transactionally by the settle /
// termination / finalize-cron paths via recalculateRoomStatus).
const computeAvailability = (
	room: { bedCount: number; occupiedBeds: number; status: RoomStatus },
	activeLeaseEndDates: Date[],
): IRoomAvailability => {
	const vacantBeds = Math.max(room.bedCount - room.occupiedBeds, 0);
	const availableNow = vacantBeds > 0 && room.status !== RoomStatus.MAINTENANCE;

	// release dates are dates only (never tenant identities); a lease whose
	// endDate already passed but whose bed is not yet freed (the finalize cron
	// runs 00:15) is clamped to "now" so we never advertise a past date
	const now = new Date();
	const upcomingReleaseDates = activeLeaseEndDates
		.map((endDate) => (endDate > now ? endDate : now))
		.sort((a, b) => a.getTime() - b.getTime())
		.map((endDate) => endDate.toISOString());

	const nextAvailableDate = availableNow
		? null
		: (upcomingReleaseDates[0] ?? null);

	return {
		vacantBeds,
		availableNow,
		nextAvailableDate,
		upcomingReleaseDates,
	};
};

// Resolve a property and ensure it belongs to the logged-in owner.
const getOwnedPropertyOrThrow = async (
	propertyId: string,
	ownerProfileId: string,
) => {
	const property = await prisma.property.findFirst({
		where: { id: propertyId, ownerId: ownerProfileId, isDeleted: false },
	});

	if (!property) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	return property;
};

// Resolve a room for an OPERATE-tier principal (spec 17): the verified owner
// or an assigned PROPERTY_MANAGER. Generic 404 on any miss (no ownership leak)
// so callers can never probe other people's rooms.
const resolveOperateRoom = async (roomId: string, user: RequestUser) => {
	if (user.role === Role.PROPERTY_MANAGER) {
		const room = await prisma.room.findFirst({
			where: {
				id: roomId,
				isDeleted: false,
				property: propertyManagerScope(user.userId),
			},
		});

		if (!room) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}

		return room;
	}

	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const room = await prisma.room.findFirst({
		where: {
			id: roomId,
			isDeleted: false,
			property: { ownerId: ownerProfile.id },
		},
	});

	if (!room) {
		throw new AppError(httpStatus.NOT_FOUND, "Room not found");
	}

	return room;
};

// Owner creates a room inside one of their properties
const createRoom = async (payload: ICreateRoomPayload, user: RequestUser) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	await getOwnedPropertyOrThrow(payload.propertyId, ownerProfile.id);

	// a unit, if provided, must belong to the same property
	if (payload.unitId) {
		const unit = await prisma.unit.findFirst({
			where: {
				id: payload.unitId,
				propertyId: payload.propertyId,
				isDeleted: false,
			},
		});

		if (!unit) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Unit does not belong to the given property",
			);
		}
	}

	const bookingDeposit = payload.bookingDeposit ?? payload.monthlyRent;

	const room = await prisma.room.create({
		data: {
			propertyId: payload.propertyId,
			unitId: payload.unitId,
			name: payload.name,
			description: payload.description,
			type: payload.type,
			bedCount: payload.bedCount ?? 1,
			monthlyRent: payload.monthlyRent,
			bookingDeposit,
			minLeaseMonths: payload.minLeaseMonths ?? 1,
			sizeSqft: payload.sizeSqft,
			isFurnished: payload.isFurnished ?? false,
			amenities: payload.amenities,
			availableFrom: payload.availableFrom
				? new Date(payload.availableFrom)
				: new Date(),
			status: RoomStatus.AVAILABLE,
			isPublished: false,
		},
	});

	return room;
};

// Owner's own rooms
const getMyRooms = async (user: RequestUser, query: IQuery) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: RoomWhereInput[] = [
		{ isDeleted: false, property: { ownerId: ownerProfile.id } },
	];

	if (query.status) {
		andConditions.push({ status: query.status as RoomStatus });
	}
	if (query.isPublished !== undefined) {
		andConditions.push({ isPublished: query.isPublished === "true" });
	}
	if (query.propertyId) {
		andConditions.push({ propertyId: query.propertyId });
	}

	const rooms = await prisma.room.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			property: { select: { id: true, title: true, city: true, images: true } },
			leases: {
				where: { status: LeaseStatus.ACTIVE, isDeleted: false },
				select: { endDate: true },
			},
			_count: { select: { applications: true, leases: true } },
		},
	});

	const total = await prisma.room.count({ where: { AND: andConditions } });

	const data = rooms.map((room) => {
		const { leases, ...roomRest } = room;

		return {
			...roomRest,
			availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
			...computeAvailability(
				room,
				leases.map((lease) => lease.endDate),
			),
		};
	});

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Vacancy + upcoming-release board for one property (owner / assigned
// manager / admin). Counts and dates only — never tenant identities, so the
// manager boundary (no PII, no money) is respected by construction.
const getPropertyAvailability = async (
	propertyId: string,
	user: RequestUser,
): Promise<IPropertyAvailabilityResponse> => {
	const property = await prisma.property.findUnique({
		where: { id: propertyId },
		select: {
			id: true,
			title: true,
			city: true,
			isDeleted: true,
			owner: { select: { userId: true } },
		},
	});

	if (!property || property.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	if (user.role === Role.OWNER) {
		// verified-owner guard (APPROVED profile required), 404 on any miss
		await getVerifiedOwnerProfile(user.userId);

		if (property.owner.userId !== user.userId) {
			throw new AppError(httpStatus.NOT_FOUND, "Property not found");
		}
	} else if (user.role === Role.PROPERTY_MANAGER) {
		const propertyRole = await resolvePropertyRole(user, propertyId);

		if (!propertyRole) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not allowed to view this property's availability",
			);
		}
	}

	const rooms = await prisma.room.findMany({
		where: { propertyId, isDeleted: false },
		select: {
			id: true,
			name: true,
			status: true,
			isPublished: true,
			bedCount: true,
			occupiedBeds: true,
			leases: {
				where: { status: LeaseStatus.ACTIVE, isDeleted: false },
				select: { endDate: true },
			},
		},
		orderBy: { createdAt: "asc" },
	});

	const decorated: IRoomAvailabilityRoom[] = rooms.map((room) => ({
		id: room.id,
		name: room.name,
		status: room.status,
		isPublished: room.isPublished,
		bedCount: room.bedCount,
		occupiedBeds: room.occupiedBeds,
		...computeAvailability(
			room,
			room.leases.map((lease) => lease.endDate),
		),
	}));

	const totalBeds = rooms.reduce((sum, room) => sum + room.bedCount, 0);
	const occupiedBeds = rooms.reduce((sum, room) => sum + room.occupiedBeds, 0);
	const vacantBeds = Math.max(totalBeds - occupiedBeds, 0);

	const notMaintenance = decorated.filter(
		(room) => room.status !== RoomStatus.MAINTENANCE,
	);

	const summary = {
		totalRooms: rooms.length,
		totalBeds,
		occupiedBeds,
		vacantBeds,
		occupancyRate: totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
		fullyVacantRooms: notMaintenance.filter((room) => room.occupiedBeds === 0)
			.length,
		partiallyOccupiedRooms: notMaintenance.filter(
			(room) => room.vacantBeds > 0 && room.occupiedBeds > 0,
		).length,
		fullRooms: notMaintenance.filter((room) => room.vacantBeds === 0).length,
		maintenanceRooms: decorated.length - notMaintenance.length,
		// earliest upcoming release across rooms with zero vacant beds
		nextAvailableDate:
			decorated
				.filter((room) => !room.availableNow && room.nextAvailableDate)
				.map((room) => room.nextAvailableDate as string)
				.sort()[0] ?? null,
	};

	return {
		property: { id: property.id, title: property.title, city: property.city },
		summary,
		rooms: decorated,
	};
};

// Public room search: published rooms that currently have at least one free
// bed. Cached in Redis (short TTL) to serve heavy browse traffic.
const getPublicRooms = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "monthlyRent";
	const sortOrder = query.sortOrder ? query.sortOrder : "asc";

	const andConditions: RoomWhereInput[] = [
		{
			isDeleted: false,
			isPublished: true,
			// rooms of a soft-deleted property must not surface publicly
			property: { isDeleted: false },
		},
	];

	// availability mode (default keeps the historical behaviour: only rooms
	// with a free bed today). "upcoming" surfaces full-but-published rooms
	// that have a bed freeing up; "all" shows everything except maintenance.
	const availabilityMode = query.availability as string | undefined;

	if (availabilityMode === "upcoming") {
		andConditions.push({
			status: RoomStatus.OCCUPIED,
			leases: { some: { status: LeaseStatus.ACTIVE, isDeleted: false } },
		});
	} else if (availabilityMode === "all") {
		andConditions.push({ status: { notIn: [RoomStatus.MAINTENANCE] } });
	} else {
		andConditions.push({
			status: { notIn: [RoomStatus.OCCUPIED, RoomStatus.MAINTENANCE] },
		});
	}

	// Searching
	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ description: { contains: query.searchTerm, mode: "insensitive" } },
				{
					property: {
						title: { contains: query.searchTerm, mode: "insensitive" },
					},
				},
				{
					property: {
						area: { contains: query.searchTerm, mode: "insensitive" },
					},
				},
			],
		});
	}

	// Filtering
	if (query.propertyType) {
		andConditions.push({ property: { type: query.propertyType } });
	}
	if (query.city) {
		andConditions.push({
			property: { city: { equals: query.city, mode: "insensitive" } },
		});
	}
	if (query.type) {
		andConditions.push({ type: query.type });
	}
	if (query.maxRent) {
		andConditions.push({ monthlyRent: { lte: Number(query.maxRent) } });
	}
	if (query.minRent) {
		andConditions.push({ monthlyRent: { gte: Number(query.minRent) } });
	}
	if (query.isFurnished === "true") {
		andConditions.push({ isFurnished: true });
	}

	const cacheKey = `room-public:${JSON.stringify({ andConditions, limit, page, sortBy, sortOrder })}`;

	// try the redis cache first, fall back to the database on any failure
	try {
		const cached = await redisClient.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}
	} catch (error) {
		console.log("Redis cache read failed (room search):", error);
	}

	const rooms = await prisma.room.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: {
			id: true,
			name: true,
			type: true,
			description: true,
			monthlyRent: true,
			bookingDeposit: true,
			minLeaseMonths: true,
			sizeSqft: true,
			isFurnished: true,
			bedCount: true,
			occupiedBeds: true,
			amenities: true,
			images: true,
			availableFrom: true,
			createdAt: true,
			status: true,
			leases: {
				where: { status: LeaseStatus.ACTIVE, isDeleted: false },
				select: { endDate: true },
			},
			property: {
				select: {
					id: true,
					title: true,
					type: true,
					city: true,
					area: true,
					images: true,
					owner: {
						select: {
							id: true,
							name: true,
							companyName: true,
							user: { select: { imageUrl: true } },
						},
					},
				},
			},
		},
	});

	// decorate each room with its currently available bed count + upcoming
	// release info (dates only)
	const data = rooms
		.map((room) => {
			const { leases, ...roomRest } = room;

			return {
				...roomRest,
				availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
				...computeAvailability(
					room,
					leases.map((lease) => lease.endDate),
				),
				// serialise decimals for a clean JSON payload
				monthlyRent: room.monthlyRent.toString(),
				bookingDeposit: room.bookingDeposit.toString(),
			};
		})
		// "upcoming" guard: drop any drift row whose occupancy counters say
		// full but has no live lease end date to advertise
		.filter(
			(room) =>
				availabilityMode !== "upcoming" || room.nextAvailableDate !== null,
		);

	const total = await prisma.room.count({
		where: { AND: andConditions },
	});

	const result = {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};

	// short TTL - search payloads go stale quickly after any owner edit
	try {
		await redisClient.set(cacheKey, JSON.stringify(result), {
			expiration: { type: "EX", value: 60 },
		});
	} catch (error) {
		console.log("Redis cache write failed (room search):", error);
	}

	return result;
};
// Single room detail - guests see only published rooms; owner/admin see all
const getRoomDetail = async (roomId: string, viewer?: RequestUser) => {
	const room = await prisma.room.findUnique({
		where: { id: roomId },
		include: {
			property: {
				include: {
					owner: { include: { user: { omit: { password: true } } } },
				},
			},
			unit: true,
			leases: {
				where: { status: LeaseStatus.ACTIVE, isDeleted: false },
				select: { endDate: true },
			},
		},
	});

	if (!room || room.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Room not found");
	}

	// public vacancy decoration (dates only — no tenant identities)
	const availability = computeAvailability(
		room,
		room.leases.map((lease) => lease.endDate),
	);

	// guest / tenant: only published rooms inside a live property are visible,
	// and the owner's private fields must never be returned
	if (!viewer || viewer.role === "TENANT") {
		if (!room.isPublished || room.property.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}

		// strip the release dates (and any future nested relation) from the
		// property shape; room-level availability data is added below
		const { owner, ...propertyRest } = room.property;
		const { leases, ...roomRest } = room;

		return {
			...roomRest,
			property: {
				...propertyRest,
				owner: owner
					? {
							id: owner.id,
							name: owner.name,
							companyName: owner.companyName,
							user: owner.user
								? { id: owner.user.id, imageUrl: owner.user.imageUrl }
								: null,
						}
					: null,
			},
			availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
			...availability,
		};
	}

	if (viewer.role === "PROPERTY_MANAGER") {
		const assignment = await prisma.propertyManager.findFirst({
			where: {
				propertyId: room.propertyId,
				manager: { userId: viewer.userId, isDeleted: false },
			},
		});

		if (!assignment) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You are not allowed to view this room",
			);
		}

		return {
			...room,
			availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
			...availability,
		};
	}

	if (viewer.role === "OWNER" && room.property.owner.userId !== viewer.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this room",
		);
	}

	return {
		...room,
		availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
		...availability,
	};
};

// Owner or assigned manager updates room details (OPERATE tier)
const updateRoom = async (
	roomId: string,
	payload: IUpdateRoomPayload,
	user: RequestUser,
) => {
	const room = await resolveOperateRoom(roomId, user);

	// cannot shrink a shared room below the number of beds currently occupied
	if (payload.bedCount !== undefined && payload.bedCount < room.occupiedBeds) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Room currently has ${room.occupiedBeds} occupied bed(s). You cannot reduce bedCount below that.`,
		);
	}

	const updatedRoom = await prisma.$transaction(async (tx) => {
		const updated = await tx.room.update({
			where: { id: roomId },
			data: {
				name: payload.name,
				description: payload.description,
				type: payload.type,
				bedCount: payload.bedCount,
				monthlyRent: payload.monthlyRent,
				bookingDeposit: payload.bookingDeposit,
				minLeaseMonths: payload.minLeaseMonths,
				sizeSqft: payload.sizeSqft,
				isFurnished: payload.isFurnished,
				amenities: payload.amenities,
			},
		});

		// occupancy-adjacent mutation (bedCount/rent): always audited,
		// regardless of whether the actor is the owner or a delegated manager
		await writeAuditLog(
			{
				action: "ROOM_UPDATED",
				entity: "Room",
				entityId: roomId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: {
					name: room.name,
					bedCount: room.bedCount,
					monthlyRent: room.monthlyRent.toString(),
				},
				after: {
					name: updated.name,
					bedCount: updated.bedCount,
					monthlyRent: updated.monthlyRent.toString(),
				},
			},
			tx,
		);

		return updated;
	});

	// a changed capacity can affect the occupancy-derived status (AVAILABLE /
	// RESERVED / OCCUPIED), so recompute it
	await recalculateRoomStatus(roomId);

	return updatedRoom;
};

// Owner or assigned manager sets availability / publishes a room (OPERATE tier)
const setRoomAvailability = async (
	roomId: string,
	payload: ISetRoomAvailabilityPayload,
	user: RequestUser,
) => {
	const room = await resolveOperateRoom(roomId, user);

	// a fully occupied room cannot be marked available again while tenants live in it
	if (payload.status === RoomStatus.AVAILABLE) {
		const activeLeaseCount = await prisma.lease.count({
			where: { roomId: room.id, status: LeaseStatus.ACTIVE, isDeleted: false },
		});

		if (activeLeaseCount >= room.bedCount) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Room is fully occupied by active leases. You cannot mark it available.",
			);
		}
	}

	return prisma.$transaction(async (tx) => {
		const updated = await tx.room.update({
			where: { id: roomId },
			data: {
				status: payload.status,
				isPublished: payload.isPublished,
				availableFrom: payload.availableFrom
					? new Date(payload.availableFrom)
					: undefined,
			},
		});

		// availability is a room status change: always audited
		await writeAuditLog(
			{
				action: "ROOM_AVAILABILITY_UPDATED",
				entity: "Room",
				entityId: roomId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: room.status, isPublished: room.isPublished },
				after: { status: updated.status, isPublished: updated.isPublished },
			},
			tx,
		);

		return updated;
	});
};

// Soft delete a room (blocks new applications)
const deleteRoom = async (roomId: string, user: RequestUser) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const room = await prisma.room.findFirst({
		where: {
			id: roomId,
			isDeleted: false,
			property: { ownerId: ownerProfile.id },
		},
	});

	if (!room) {
		throw new AppError(httpStatus.NOT_FOUND, "Room not found");
	}

	const activeLeaseCount = await prisma.lease.count({
		where: { roomId: room.id, status: LeaseStatus.ACTIVE, isDeleted: false },
	});

	if (activeLeaseCount > 0) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Room cannot be deleted while it has active leases",
		);
	}

	return prisma.room.update({
		where: { id: roomId },
		data: { isDeleted: true, deletedAt: new Date(), isPublished: false },
	});
};

// Room images
const uploadRoomImages = async (
	roomId: string,
	buffers: Buffer[],
	user: RequestUser,
) => {
	const room = await resolveOperateRoom(roomId, user);

	const uploadResults = await Promise.all(
		buffers.map((buffer) => uploadFileToCloudinary(buffer, "room-images")),
	);

	const newImages: TImage[] = uploadResults.map((result) => ({
		url: result.secure_url,
		publicId: result.public_id,
	}));

	const previousImages = (room.images as TImage[]) || [];
	const images = [...previousImages, ...newImages];

	await prisma.room.update({
		where: { id: roomId },
		data: { images: images as any },
	});

	return images;
};

const removeRoomImage = async (
	roomId: string,
	publicId: string,
	user: RequestUser,
) => {
	const room = await resolveOperateRoom(roomId, user);

	const existingImages = (room.images as TImage[]) || [];
	const targetImage = existingImages.find((img) => img.publicId === publicId);

	if (!targetImage) {
		throw new AppError(httpStatus.NOT_FOUND, "Image not found");
	}

	const images = existingImages.filter((img) => img.publicId !== publicId);

	await prisma.room.update({
		where: { id: roomId },
		data: { images: images as any },
	});

	// the asset belonged to this room, so it is safe to purge from cloudinary
	await deleteFromCloudinary(publicId);

	return images;
};

export const RoomServices = {
	createRoom,
	getMyRooms,
	getPropertyAvailability,
	getPublicRooms,
	getRoomDetail,
	updateRoom,
	setRoomAvailability,
	deleteRoom,
	uploadRoomImages,
	removeRoomImage,
};
