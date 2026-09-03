import httpStatus from "http-status";
import { LeaseStatus, RoomStatus } from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { RoomWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";
import { getVerifiedOwnerProfile } from "../../utils/ownerGuard";
import { recalculateRoomStatus } from "../../utils/roomStatus";
import type {
	ICreateRoomPayload,
	ISetRoomAvailabilityPayload,
	IUpdateRoomPayload,
} from "./room.interface";

type TImage = { url: string; publicId: string };

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
			_count: { select: { applications: true, leases: true } },
		},
	});

	const total = await prisma.room.count({ where: { AND: andConditions } });

	return {
		data: rooms,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
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
		{ status: { notIn: [RoomStatus.OCCUPIED, RoomStatus.MAINTENANCE] } },
	];

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

	// decorate each room with its currently available bed count
	const data = rooms.map((room) => ({
		...room,
		availableBeds: Math.max(room.bedCount - room.occupiedBeds, 0),
		// serialise decimals for a clean JSON payload
		monthlyRent: room.monthlyRent.toString(),
		bookingDeposit: room.bookingDeposit.toString(),
	}));

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
		},
	});

	if (!room || room.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Room not found");
	}

	// guest / tenant: only published rooms inside a live property are visible,
	// and the owner's private fields must never be returned
	if (!viewer || viewer.role === "TENANT") {
		if (!room.isPublished || room.property.isDeleted) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}

		const { owner, ...propertyRest } = room.property;
		return {
			...room,
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
		};
	}

	if (viewer.role === "OWNER" && room.property.owner.userId !== viewer.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this room",
		);
	}

	return room;
};

// Owner updates room details
const updateRoom = async (
	roomId: string,
	payload: IUpdateRoomPayload,
	user: RequestUser,
) => {
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

	// cannot shrink a shared room below the number of beds currently occupied
	if (payload.bedCount !== undefined && payload.bedCount < room.occupiedBeds) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Room currently has ${room.occupiedBeds} occupied bed(s). You cannot reduce bedCount below that.`,
		);
	}

	const updatedRoom = await prisma.room.update({
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

	// a changed capacity can affect the occupancy-derived status (AVAILABLE /
	// RESERVED / OCCUPIED), so recompute it
	await recalculateRoomStatus(roomId);

	return updatedRoom;
};

// Owner sets availability / publishes a room
const setRoomAvailability = async (
	roomId: string,
	payload: ISetRoomAvailabilityPayload,
	user: RequestUser,
) => {
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

	return prisma.room.update({
		where: { id: roomId },
		data: {
			status: payload.status,
			isPublished: payload.isPublished,
			availableFrom: payload.availableFrom
				? new Date(payload.availableFrom)
				: undefined,
		},
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
	getPublicRooms,
	getRoomDetail,
	updateRoom,
	setRoomAvailability,
	deleteRoom,
	uploadRoomImages,
	removeRoomImage,
};
