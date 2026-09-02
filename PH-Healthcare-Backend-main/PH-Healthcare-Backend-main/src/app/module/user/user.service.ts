import { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { cloudinary } from "../../lib/cloudinary";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";

const uploadProfileImage = async (buffer: Buffer, userId: string) => {
  //   const cloudinaryResult = cloudinary.uploader
  //     .upload_stream(
  //       {
  //         resource_type: "auto",
  //       },
  //       async (error, result) => {
  //         if (error) {
  //           console.log(error);
  //           throw new Error(error.message);
  //         }

  //         console.log(result, "Result");

  //         // Update user profile image in the database
  //         const updateUser = await prisma.user.update({
  //           where: {
  //             id: userId,
  //           },
  //           data: {
  //             imageUrl: result?.secure_url,
  //             imagePublicId: result?.public_id,
  //           },
  //         });

  //         console.log(updateUser);

  //         // return result;
  //       },
  //     )
  //     .end(buffer);

  // Check if the user already has a profile image
  const currentUser = await prisma.user.findUnique({
    where: {
      id: userId,
    },
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
    where: {
      id: userId,
    },
    data: {
      imageUrl: cloudinaryResult?.secure_url,
      imagePublicId: cloudinaryResult?.public_id,
    },
    omit: {
      password: true,
    },
  });

  // Delete previous image from cloudinary if it exists
  if (currentUser?.imageUrl && currentUser?.imagePublicId) {
    await cloudinary.uploader.destroy(currentUser?.imagePublicId);
  }

  return updateUser;
};

export const UserServices = {
  uploadProfileImage,
};
