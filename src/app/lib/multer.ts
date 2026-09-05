import type { NextFunction, Request, RequestHandler, Response } from "express";
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

// The multipart Content-Type is client-controlled, so every allowed type is
// additionally verified against its magic bytes — a renamed executable can
// never pass as an image/PDF.
const MAGIC_SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
	"image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	"image/png": (b) =>
		b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
	"image/gif": (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
	"image/webp": (b) =>
		b.subarray(0, 4).toString("latin1") === "RIFF" &&
		b.subarray(8, 12).toString("latin1") === "WEBP",
	"application/pdf": (b) => b.subarray(0, 4).toString("latin1") === "%PDF",
};

const hasValidSignature = (file: Express.Multer.File) => {
	const check = MAGIC_SIGNATURES[file.mimetype];
	if (!check) return false;
	return check(file.buffer);
};

// multer's fileFilter fires BEFORE memoryStorage has buffered any bytes, so
// the mimetype check happens there (early reject, nothing buffered) while the
// magic-byte verification runs in a wrapper AFTER multer completes, on the
// actual content of every buffered file.
const makeGuardedUpload = (allowed: string[], label: string) => {
	const instance = multer({
		storage,
		limits,
		fileFilter: (
			_req: Request,
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
		},
	});

	const wrap = (make: (uploader: multer.Multer) => RequestHandler) => {
		const handler = make(instance);

		return (req: Request, res: Response, next: NextFunction) => {
			handler(req, res, (err?: unknown) => {
				if (err) {
					next(err);
					return;
				}

				try {
					const files = req.file
						? [req.file]
						: ((req.files as Express.Multer.File[] | undefined) ?? []);

					for (const file of files) {
						if (!allowed.includes(file.mimetype) || !hasValidSignature(file)) {
							throw new AppError(
								httpStatus.BAD_REQUEST,
								`Only ${label} files are allowed (${allowed.join(", ")})`,
							);
						}
					}

					next();
				} catch (error) {
					next(error);
				}
			});
		};
	};

	return {
		single: (field: string) => wrap((uploader) => uploader.single(field)),
		array: (field: string, maxCount: number) =>
			wrap((uploader) => uploader.array(field, maxCount)),
	};
};

// Image-only uploads: profile pictures, property/room galleries,
// maintenance photos.
export const uploadImages = makeGuardedUpload(IMAGE_MIME_TYPES, "image");

// Image + PDF uploads: lease documents and identity verification documents.
export const uploadDocuments = makeGuardedUpload(
	DOCUMENT_MIME_TYPES,
	"image or PDF",
);
