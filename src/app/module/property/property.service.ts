import httpStatus from "http-status";
import { Role } from "../../../generated/prisma/enums";
import type { PropertyWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";
import { getVerifiedOwnerProfile } from "../../utils/ownerGuard";
import type {
	ICreatePropertyPayload,
	ICreateUnitPayload,
	IUpdatePropertyPayload,
	IUpdateUnitPayload,
} from "./property.interface";

type TImage = { url: string; publicId: string };

// Owner creates a new property (building / listing)
const createProperty = async (
	payload: ICreatePropertyPayload,
	user: RequestUser,
) => {
	// only verified owners can create listings
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const property = await prisma.property.create({
		data: {
			title: payload.title,
			description: payload.description,
			type: payload.type,
			city: payload.city,
			area: payload.area,
			address: payload.address,
			googleMapUrl: payload.googleMapUrl,
			amenities: payload.amenities,
			houseRules: payload.houseRules,
			ownerId: ownerProfile.id,
		},
	});

	return property;
};

// Owner sees only their own properties
const getMyProperties = async (user: RequestUser, query: IQuery) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: PropertyWhereInput[] = [
		{ ownerId: ownerProfile.id, isDeleted: false },
	];

	if (query.city) {
		andConditions.push({ city: { equals: query.city, mode: "insensitive" } });
	}

	const properties = await prisma.property.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			units: { where: { isDeleted: false } },
			rooms: {
				where: { isDeleted: false },
				select: {
					id: true,
					name: true,
					type: true,
					monthlyRent: true,
					status: true,
					isPublished: true,
					bedCount: true,
					occupiedBeds: true,
				},
			},
			_count: { select: { rooms: true } },
		},
	});

	const total = await prisma.property.count({ where: { AND: andConditions } });

	return {
		data: properties,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Public listing: published properties (with at least one published room)
const getPublicProperties = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: PropertyWhereInput[] = [
		{ isDeleted: false },
		{
			rooms: {
				some: { isDeleted: false, isPublished: true },
			},
		},
	];

	// Searching
	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ title: { contains: query.searchTerm, mode: "insensitive" } },
				{ description: { contains: query.searchTerm, mode: "insensitive" } },
				{ area: { contains: query.searchTerm, mode: "insensitive" } },
				{ city: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	// Filtering
	if (query.city) {
		andConditions.push({ city: { equals: query.city, mode: "insensitive" } });
	}
	if (query.type) {
		andConditions.push({ type: query.type });
	}

	const properties = await prisma.property.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		select: {
			id: true,
			title: true,
			description: true,
			type: true,
			city: true,
			area: true,
			address: true,
			images: true,
			amenities: true,
			createdAt: true,
			owner: {
				select: {
					id: true,
					name: true,
					companyName: true,
					user: { select: { imageUrl: true } },
				},
			},
			rooms: {
				where: { isDeleted: false, isPublished: true },
				orderBy: { monthlyRent: "asc" as const },
				select: {
					id: true,
					name: true,
					type: true,
					monthlyRent: true,
					bedCount: true,
					occupiedBeds: true,
					images: true,
					isFurnished: true,
				},
			},
			_count: {
				select: {
					rooms: { where: { isDeleted: false, isPublished: true } },
				},
			},
		},
	});

	const total = await prisma.property.count({ where: { AND: andConditions } });

	return {
		data: properties,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Single property detail. Public users only get published rooms, owners/admins
// see the full picture (incl. draft & occupied rooms).
const getPropertyDetail = async (propertyId: string, viewer?: RequestUser) => {
	const property = await prisma.property.findUnique({
		where: { id: propertyId },
		include: {
			owner: { include: { user: { omit: { password: true } } } },
			units: { where: { isDeleted: false } },
			rooms: {
				where: { isDeleted: false },
				include: { unit: true },
				orderBy: { monthlyRent: "asc" },
			},
		},
	});

	if (!property || property.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	// Tenant/guest viewers can only browse published rooms of a property
	if (!viewer || viewer.role === Role.TENANT) {
		return {
			...property,
			rooms: property.rooms.filter((room) => room.isPublished),
			units: [],
		};
	}

	// Owners can only inspect their own property, admins can inspect anything
	if (viewer.role === Role.OWNER && property.owner.userId !== viewer.userId) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view this property",
		);
	}

	return property;
};

// Owner updates their own property
const updateProperty = async (
	propertyId: string,
	payload: IUpdatePropertyPayload,
	user: RequestUser,
) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const existingProperty = await prisma.property.findUnique({
		where: { id: propertyId, ownerId: ownerProfile.id, isDeleted: false },
	});

	if (!existingProperty) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	return prisma.property.update({
		where: { id: propertyId },
		data: {
			title: payload.title,
			description: payload.description,
			type: payload.type,
			city: payload.city,
			area: payload.area,
			address: payload.address,
			googleMapUrl: payload.googleMapUrl,
			amenities: payload.amenities,
			houseRules: payload.houseRules,
		},
	});
};

// Soft delete a property (owner of it, or any admin)
const deleteProperty = async (
	propertyId: string,
	user: RequestUser,
	isAdmin = false,
) => {
	const existingProperty = await prisma.property.findUnique({
		where: { id: propertyId, isDeleted: false },
	});

	if (!existingProperty) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	if (!isAdmin) {
		const ownerProfile = await getVerifiedOwnerProfile(user.userId);
		if (existingProperty.ownerId !== ownerProfile.id) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"You can only delete your own properties",
			);
		}
	}

	return prisma.property.update({
		where: { id: propertyId },
		data: { isDeleted: true, deletedAt: new Date() },
	});
};

// All properties (admin moderation view)
const getAllProperties = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: PropertyWhereInput[] = [{ isDeleted: false }];

	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ title: { contains: query.searchTerm, mode: "insensitive" } },
				{ city: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}
	if (query.city) {
		andConditions.push({ city: { equals: query.city, mode: "insensitive" } });
	}
	if (query.type) {
		andConditions.push({ type: query.type });
	}
	if (query.ownerId) {
		andConditions.push({ ownerId: query.ownerId });
	}

	const properties = await prisma.property.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			owner: {
				select: {
					id: true,
					name: true,
					email: true,
					verificationStatus: true,
				},
			},
			_count: { select: { rooms: true } },
		},
	});

	const total = await prisma.property.count({ where: { AND: andConditions } });

	return {
		data: properties,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// ---------------- Units ----------------

const createUnit = async (
	propertyId: string,
	payload: ICreateUnitPayload,
	user: RequestUser,
) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const property = await prisma.property.findUnique({
		where: { id: propertyId, ownerId: ownerProfile.id, isDeleted: false },
	});

	if (!property) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	return prisma.unit.create({
		data: { propertyId, ...payload },
	});
};

const updateUnit = async (
	unitId: string,
	payload: IUpdateUnitPayload,
	user: RequestUser,
) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const unit = await prisma.unit.findFirst({
		where: {
			id: unitId,
			isDeleted: false,
			property: { ownerId: ownerProfile.id },
		},
	});

	if (!unit) {
		throw new AppError(httpStatus.NOT_FOUND, "Unit not found");
	}

	return prisma.unit.update({ where: { id: unitId }, data: payload });
};

const deleteUnit = async (unitId: string, user: RequestUser) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const unit = await prisma.unit.findFirst({
		where: {
			id: unitId,
			isDeleted: false,
			property: { ownerId: ownerProfile.id },
		},
	});

	if (!unit) {
		throw new AppError(httpStatus.NOT_FOUND, "Unit not found");
	}

	return prisma.unit.update({
		where: { id: unitId },
		data: { isDeleted: true, deletedAt: new Date() },
	});
};

// ---------------- Images ----------------

const uploadPropertyImages = async (
	propertyId: string,
	buffers: Buffer[],
	user: RequestUser,
) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const property = await prisma.property.findUnique({
		where: { id: propertyId, ownerId: ownerProfile.id, isDeleted: false },
	});

	if (!property) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	const uploadResults = await Promise.all(
		buffers.map((buffer) => uploadFileToCloudinary(buffer, "property-images")),
	);

	const newImages: TImage[] = uploadResults.map((result) => ({
		url: result.secure_url,
		publicId: result.public_id,
	}));

	const previousImages = (property.images as TImage[]) || [];
	const images = [...previousImages, ...newImages];

	await prisma.property.update({
		where: { id: propertyId },
		data: { images: images as any },
	});

	return images;
};

const removePropertyImage = async (
	propertyId: string,
	publicId: string,
	user: RequestUser,
) => {
	const ownerProfile = await getVerifiedOwnerProfile(user.userId);

	const property = await prisma.property.findUnique({
		where: { id: propertyId, ownerId: ownerProfile.id, isDeleted: false },
	});

	if (!property) {
		throw new AppError(httpStatus.NOT_FOUND, "Property not found");
	}

	const images = ((property.images as TImage[]) || []).filter(
		(img) => img.publicId !== publicId,
	);

	await prisma.property.update({
		where: { id: propertyId },
		data: { images: images as any },
	});

	await deleteFromCloudinary(publicId);

	return images;
};

export const PropertyServices = {
	createProperty,
	getMyProperties,
	getPublicProperties,
	getPropertyDetail,
	updateProperty,
	deleteProperty,
	getAllProperties,
	createUnit,
	updateUnit,
	deleteUnit,
	uploadPropertyImages,
	removePropertyImage,
};
