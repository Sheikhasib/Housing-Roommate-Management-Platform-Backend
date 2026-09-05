import httpStatus from "http-status";
import { VerificationStatus } from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";
import type { RequestUser } from "../../middleware/checkAuth";
import type { IUpdateTenantProfilePayload } from "./tenant.interface";

// Update my own tenant profile (also drives roommate matching preferences)
const updateMyTenantProfile = async (
	payload: IUpdateTenantProfilePayload,
	user: RequestUser,
) => {
	const existingTenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!existingTenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant Profile Not Found");
	}

	// nothing provided: skip the no-op write (it would still bump updatedAt)
	if (Object.keys(payload).length === 0) {
		return existingTenantProfile;
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
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
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

// TENANT: upload/replace the identity verification document (NID etc).
// A new document always re-enters the PENDING queue for admin review.
const uploadVerificationDocument = async (
	buffer: Buffer,
	user: RequestUser,
) => {
	const existingTenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!existingTenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant Profile Not Found");
	}

	const uploadResult = await uploadFileToCloudinary(
		buffer,
		"verification-docs",
	);

	const updatedTenantProfile = await prisma.tenantProfile.update({
		where: { id: existingTenantProfile.id },
		data: {
			verificationDocUrl: uploadResult.secure_url,
			verificationDocPublicId: uploadResult.public_id,
			// a re-upload (e.g. after a rejection) restarts the review cycle
			verificationStatus: VerificationStatus.PENDING,
			rejectionReason: null,
			reviewedBy: null,
			reviewedAt: null,
		},
	});

	// best-effort cleanup of the replaced document
	if (
		existingTenantProfile.verificationDocPublicId &&
		existingTenantProfile.verificationDocPublicId !== uploadResult.public_id
	) {
		await deleteFromCloudinary(existingTenantProfile.verificationDocPublicId);
	}

	return updatedTenantProfile;
};

export const TenantServices = {
	updateMyTenantProfile,
	getMyTenantProfile,
	uploadVerificationDocument,
};
