import httpStatus from "http-status";
import { OwnerVerificationStatus } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

// Resolve the logged-in user's owner profile and make sure they have been
// verified by an admin. Only verified owners can list/manage properties.
export const getVerifiedOwnerProfile = async (userId: string) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: {
			userId,
			isDeleted: false,
		},
	});

	if (!ownerProfile) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Owner profile not found. Please register as an owner first.",
		);
	}

	if (ownerProfile.verificationStatus !== OwnerVerificationStatus.APPROVED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			`Your owner account is ${ownerProfile.verificationStatus.toLowerCase()}. You can list properties only after an admin approves your account.`,
		);
	}

	return ownerProfile;
};
