import httpStatus from "http-status";
import type { PropertyWhereInput } from "../../../generated/prisma/models";
import type { IQuery } from "../../interfaces";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { propertyManagerScope } from "../../utils/propertyAccess";
import type { IUpdateManagerProfilePayload } from "./manager.interface";

// Get my manager profile together with the linked auth user summary
const getMyManagerProfile = async (user: RequestUser) => {
	const managerProfile = await prisma.managerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
		include: {
			user: {
				omit: {
					password: true,
				},
			},
		},
	});

	if (!managerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Manager profile not found");
	}

	return managerProfile;
};

// Update my own manager profile (contact/bio only; no verification flow)
const updateMyManagerProfile = async (
	payload: IUpdateManagerProfilePayload,
	user: RequestUser,
) => {
	const existingManagerProfile = await prisma.managerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!existingManagerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Manager profile not found");
	}

	// nothing provided: skip the no-op write (it would still bump updatedAt)
	if (Object.keys(payload).length === 0) {
		return existingManagerProfile;
	}

	return prisma.managerProfile.update({
		where: { id: existingManagerProfile.id },
		data: {
			contactNumber: payload.contactNumber,
			bio: payload.bio,
		},
	});
};

// Properties the manager is assigned to (delegation scope, spec 17).
// Membership only — there is no verified-owner requirement on this path.
const getMyManagedProperties = async (user: RequestUser, query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: PropertyWhereInput[] = [
		{ isDeleted: false },
		propertyManagerScope(user.userId),
	];

	const properties = await prisma.property.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
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
			_count: { select: { rooms: { where: { isDeleted: false } } } },
		},
	});

	const total = await prisma.property.count({ where: { AND: andConditions } });

	return {
		data: properties,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

export const ManagerServices = {
	getMyManagerProfile,
	updateMyManagerProfile,
	getMyManagedProperties,
};
