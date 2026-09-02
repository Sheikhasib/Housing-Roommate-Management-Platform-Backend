import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import type { RequestUser } from "../../middleware/checkAuth";
import type { IUpdateTenantProfilePayload } from "./tenant.interface";

// Update my own tenant profile (also drives roommate matching preferences)
const updateMyTenantProfile = async (
	payload: IUpdateTenantProfilePayload,
	user: RequestUser,
) => {
	const existingTenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!existingTenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant Profile Not Found");
	}

	const updatedTenantProfile = await prisma.tenantProfile.update({
		where: { id: existingTenantProfile.id },
		data: {
			contactNumber: payload.contactNumber,
			gender: payload.gender,
			dateOfBirth: payload.dateOfBirth
				? new Date(payload.dateOfBirth)
				: undefined,
			occupation: payload.occupation,
			bio: payload.bio,
			preferredCity: payload.preferredCity,
			monthlyBudgetMax: payload.monthlyBudgetMax,
			moveInDate: payload.moveInDate ? new Date(payload.moveInDate) : undefined,
			smoker: payload.smoker,
			petFriendly: payload.petFriendly,
			hasPets: payload.hasPets,
			lookingForRoommate: payload.lookingForRoommate,
		},
	});

	return updatedTenantProfile;
};

// Get my tenant profile together with the linked auth user summary
const getMyTenantProfile = async (user: RequestUser) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
		include: {
			user: {
				omit: {
					password: true,
				},
			},
		},
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant Profile Not Found");
	}

	return tenantProfile;
};

export const TenantServices = {
	updateMyTenantProfile,
	getMyTenantProfile,
};
