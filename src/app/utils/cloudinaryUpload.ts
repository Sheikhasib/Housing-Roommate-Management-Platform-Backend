import { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import { cloudinary } from "../lib/cloudinary";
import { AppError } from "./AppError";

// Upload a single buffer (file/image) to Cloudinary and resolve the result.
export const uploadFileToCloudinary = (
	buffer: Buffer,
	folder = "housing-roommate",
): Promise<UploadApiResponse> => {
	return new Promise<UploadApiResponse>((resolve, reject) => {
		cloudinary.uploader
			.upload_stream(
				{
					resource_type: "auto",
					folder,
				},
				(error, result) => {
					if (error) {
						console.log("Cloudinary upload error:", error);
						return reject(error);
					}

					if (!result) {
						return reject(
							new AppError(
								httpStatus.BAD_GATEWAY,
								"Failed to upload file to Cloudinary",
							),
						);
					}

					resolve(result);
				},
			)
			.end(buffer);
	});
};

// Upload several buffers at once.
export const uploadFilesToCloudinary = async (
	buffers: Buffer[],
	folder = "housing-roommate",
) => {
	return Promise.all(
		buffers.map((buffer) => uploadFileToCloudinary(buffer, folder)),
	);
};

// Remove a previously uploaded asset (by public id).
export const deleteFromCloudinary = async (publicId: string) => {
	try {
		await cloudinary.uploader.destroy(publicId);
	} catch (error) {
		console.log("Failed to delete asset from Cloudinary:", error);
	}
};
