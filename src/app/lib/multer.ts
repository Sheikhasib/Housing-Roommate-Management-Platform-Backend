import httpStatus from "http-status";
import multer from "multer";
import { AppError } from "../utils/AppError";

// Set up Multer for handling file uploads (memory storage: buffers are pushed
// straight to Cloudinary by the services).

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB per file

const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// documents = images + PDF (NID, rental agreements, verification docs)
const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"];

const storage = multer.memoryStorage();

const limits = { fileSize: MAX_FILE_SIZE_BYTES };

const buildFileFilter = (allowed: string[], label: string) => {
	return (
		_req: Express.Request,
		file: Express.Multer.File,
		cb: multer.FileFilterCallback,
	) => {
		if (allowed.includes(file.mimetype)) {
			cb(null, true);
			return;
		}

		cb(
			new AppError(
				httpStatus.BAD_REQUEST,
				`Only ${label} files are allowed (${allowed.join(", ")})`,
			),
		);
	};
};

// Image-only uploads: profile pictures, property/room galleries,
// maintenance photos.
export const uploadImages = multer({
	storage,
	limits,
	fileFilter: buildFileFilter(IMAGE_MIME_TYPES, "image"),
});

// Image + PDF uploads: lease documents and identity verification documents.
export const uploadDocuments = multer({
	storage,
	limits,
	fileFilter: buildFileFilter(DOCUMENT_MIME_TYPES, "image or PDF"),
});
