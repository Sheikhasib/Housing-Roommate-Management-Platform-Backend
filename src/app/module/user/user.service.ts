import httpStatus from "http-status";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";

// Upload a profile image to Cloudinary and swap it on the user record.
const uploadProfileImage = async (buffer: Buffer, userId: string) => {
	// Check if the user already has a profile image
	const currentUser = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			imageUrl: true,
			imagePublicId: true,
		},
	});

	let cloudinaryResult;
	try {
		cloudinaryResult = await uploadFileToCloudinary(buffer, "user-profiles");
	} catch (error) {
		console.log("Cloudinary profile image upload error:", error);
		throw new AppError(
			httpStatus.BAD_GATEWAY,
			"Failed to upload image to Cloudinary",
		);
	}

	// Update user profile image in the database
	const updateUser = await prisma.user.update({
		where: { id: userId },
		data: {
			imageUrl: cloudinaryResult.secure_url,
			imagePublicId: cloudinaryResult.public_id,
		},
		omit: { password: true },
	});

	// Best-effort cleanup of the replaced image: must never fail the request
	// after the new image is already saved
	if (currentUser?.imageUrl && currentUser?.imagePublicId) {
		await deleteFromCloudinary(currentUser.imagePublicId);
	}

	return updateUser;
};

// Update the display name on the user + sync it to their role profile so the
// denormalised name/email copies stay consistent.
const updateUserProfile = async (
	userId: string,
	payload: { name?: string },
) => {
	const existingUser = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			tenantProfile: { select: { id: true } },
			ownerProfile: { select: { id: true } },
		},
	});

	if (!existingUser) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	// nothing to change: skip the pointless UPDATE round-trip and answer with
	// the same shape a real update would return
	if (!payload.name) {
		return prisma.user.findUniqueOrThrow({
			where: { id: userId },
			omit: { password: true },
		});
	}

	if (payload.name.length < 3) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Name must be at least 3 characters long",
		);
	}

	const updatedUser = await prisma.$transaction(async (tx) => {
		const user = await tx.user.update({
			where: { id: userId },
			data: { name: payload.name },
			omit: { password: true },
		});

		// keep the role profile's denormalised name in sync
		if (existingUser.tenantProfile) {
			await tx.tenantProfile.update({
				where: { id: existingUser.tenantProfile.id },
				data: { name: payload.name },
			});
		}

		if (existingUser.ownerProfile) {
			await tx.ownerProfile.update({
				where: { id: existingUser.ownerProfile.id },
				data: { name: payload.name },
			});
		}

		return user;
	});

	return updatedUser;
};

export const UserServices = {
	uploadProfileImage,
	updateUserProfile,
};
