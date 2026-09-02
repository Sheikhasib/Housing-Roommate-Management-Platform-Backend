import { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

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

	// Upload image to Cloudinary and get the result
	const cloudinaryResult = await new Promise<UploadApiResponse>(
		(resolve, reject) => {
			cloudinary.uploader
				.upload_stream(
					{
						resource_type: "auto",
					},
					async (error, result) => {
						if (error) {
							console.log(error);
							return reject(error);
						}

						if (!result) {
							return reject(
								new AppError(
									httpStatus.BAD_GATEWAY,
									"Failed to upload image to Cloudinary",
								),
							);
						}

						resolve(result);
					},
				)
				.end(buffer);
		},
	);

	// Update user profile image in the database
	const updateUser = await prisma.user.update({
		where: { id: userId },
		data: {
			imageUrl: cloudinaryResult?.secure_url,
			imagePublicId: cloudinaryResult?.public_id,
		},
		omit: { password: true },
	});

	// Delete previous image from cloudinary if it exists
	if (currentUser?.imageUrl && currentUser?.imagePublicId) {
		await cloudinary.uploader.destroy(currentUser?.imagePublicId);
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
		include: { tenantProfile: true, ownerProfile: true },
	});

	if (!existingUser) {
		throw new AppError(httpStatus.NOT_FOUND, "User not found");
	}

	const updateData: { name?: string } = {};

	if (payload.name) {
		if (payload.name.length < 3) {
			throw new AppError(
				httpStatus.BAD_REQUEST,
				"Name must be at least 3 characters long",
			);
		}
		updateData.name = payload.name;
	}

	const updatedUser = await prisma.$transaction(async (tx) => {
		const user = await tx.user.update({
			where: { id: userId },
			data: updateData,
			omit: { password: true },
		});

		// keep the role profile's denormalised name in sync
		if (existingUser.tenantProfile && payload.name) {
			await tx.tenantProfile.update({
				where: { id: existingUser.tenantProfile.id },
				data: { name: payload.name },
			});
		}

		if (existingUser.ownerProfile && payload.name) {
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
