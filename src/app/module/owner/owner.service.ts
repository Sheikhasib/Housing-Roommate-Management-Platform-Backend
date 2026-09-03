import httpStatus from "http-status";
import {
	NotificationType,
	OwnerVerificationStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { OwnerProfileWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { writeAuditLog } from "../../utils/audit";
import {
	deleteFromCloudinary,
	uploadFileToCloudinary,
} from "../../utils/cloudinaryUpload";
import type {
	IUpdateOwnerProfilePayload,
	IVerifyOwnerPayload,
} from "./owner.interface";

type TDocument = { url: string; publicId: string };

// Approve / reject an owner's verification application (ADMIN only)
const verifyOwnerProfile = async (
	payload: IVerifyOwnerPayload,
	reviewer: RequestUser,
) => {
	const { ownerProfileId, verificationStatus, rejectionReason } = payload;

	const existingOwnerProfile = await prisma.ownerProfile.findUnique({
		where: { id: ownerProfileId },
		include: { user: true },
	});

	if (!existingOwnerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	if (existingOwnerProfile.isDeleted) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Owner profile has already been deleted",
		);
	}

	if (
		existingOwnerProfile.verificationStatus !== OwnerVerificationStatus.PENDING
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Owner verification has already been ${existingOwnerProfile.verificationStatus.toLowerCase()}`,
		);
	}

	if (
		verificationStatus === OwnerVerificationStatus.REJECTED &&
		!rejectionReason
	) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Rejection reason is required when rejecting an owner",
		);
	}

	const isApproved = verificationStatus === OwnerVerificationStatus.APPROVED;

	// status change + audit commit atomically so the decision is never un-logged
	const updatedOwnerProfile = await prisma.$transaction(async (tx) => {
		const updated = await tx.ownerProfile.update({
			where: { id: ownerProfileId },
			data: {
				verificationStatus,
				rejectionReason:
					verificationStatus === OwnerVerificationStatus.REJECTED
						? rejectionReason
						: null,
				reviewedBy: reviewer.userId,
				reviewedAt: new Date(),
			},
		});

		// audit trail of the decision
		await writeAuditLog(
			{
				action: isApproved ? "OWNER_APPROVED" : "OWNER_REJECTED",
				entity: "OwnerProfile",
				entityId: ownerProfileId,
				actorId: reviewer.userId,
				actorEmail: reviewer.email,
				actorRole: reviewer.role,
				before: {
					verificationStatus: existingOwnerProfile.verificationStatus,
				},
				after: { verificationStatus },
			},
			tx,
		);

		return updated;
	});

	// email + in-app notification for the owner
	await sendTemplateEmail({
		to: existingOwnerProfile.email,
		subject: isApproved
			? "Your Owner Account Has Been Approved"
			: "Your Owner Account Has Been Rejected",
		template: isApproved ? "owner-account-approved" : "owner-account-rejected",
		data: {
			name: existingOwnerProfile.name,
			reason: existingOwnerProfile.rejectionReason,
		},
	});

	await createNotification({
		userId: existingOwnerProfile.userId,
		type: NotificationType.SYSTEM,
		title: isApproved
			? "Owner account approved ✅"
			: "Owner account rejected ❌",
		message: isApproved
			? "Your owner account has been approved. You can now list your properties."
			: `Your owner account was rejected. Reason: ${existingOwnerProfile.rejectionReason || "not provided"}`,
		data: { ownerProfileId },
	});

	return updatedOwnerProfile;
};

// Upload identity / proof-of-ownership documents (owner self service)
const uploadVerificationDocuments = async (
	user: RequestUser,
	buffers: Buffer[],
) => {
	if (buffers.length === 0) {
		throw new AppError(httpStatus.BAD_REQUEST, "No documents uploaded");
	}

	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const uploadResults = await Promise.all(
		buffers.map((buffer) => uploadFileToCloudinary(buffer, "owner-documents")),
	);

	const newDocuments: TDocument[] = uploadResults.map((result) => ({
		url: result.secure_url,
		publicId: result.public_id,
	}));

	// merge with any previously uploaded documents
	const previousDocuments = (ownerProfile.documents as TDocument[]) || [];
	const documents = [...previousDocuments, ...newDocuments];

	await prisma.ownerProfile.update({
		where: { id: ownerProfile.id },
		data: { documents: documents as any },
	});

	return documents;
};

// Allow a rejected owner to re-submit their profile for verification
const requestVerification = async (user: RequestUser) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	if (ownerProfile.verificationStatus === OwnerVerificationStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Owner verification is already pending",
		);
	}

	const updatedOwnerProfile = await prisma.ownerProfile.update({
		where: { id: ownerProfile.id },
		data: {
			verificationStatus: OwnerVerificationStatus.PENDING,
			rejectionReason: null,
			reviewedBy: null,
			reviewedAt: null,
		},
	});

	return updatedOwnerProfile;
};

// Update my own owner profile
const updateMyOwnerProfile = async (
	payload: IUpdateOwnerProfilePayload,
	user: RequestUser,
) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const updatedOwnerProfile = await prisma.ownerProfile.update({
		where: { id: ownerProfile.id },
		data: payload,
	});

	return updatedOwnerProfile;
};

// Get my owner profile
const getMyOwnerProfile = async (user: RequestUser) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
		include: { user: { omit: { password: true } } },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	return ownerProfile;
};

// Get all owner profiles (ADMIN) with search/filter/pagination
const getAllOwners = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;
	const sortBy = query.sortBy ? query.sortBy : "createdAt";
	const sortOrder = query.sortOrder ? query.sortOrder : "desc";

	const andConditions: OwnerProfileWhereInput[] = [{ isDeleted: false }];

	// Searching
	if (query.searchTerm) {
		andConditions.push({
			OR: [
				{ name: { contains: query.searchTerm, mode: "insensitive" } },
				{ email: { contains: query.searchTerm, mode: "insensitive" } },
				{ companyName: { contains: query.searchTerm, mode: "insensitive" } },
			],
		});
	}

	// Filtering
	if (query.verificationStatus) {
		andConditions.push({
			verificationStatus: query.verificationStatus as OwnerVerificationStatus,
		});
	}

	const owners = await prisma.ownerProfile.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { [sortBy]: sortOrder },
		include: {
			user: {
				select: {
					id: true,
					name: true,
					email: true,
					role: true,
					status: true,
					imageUrl: true,
					createdAt: true,
				},
			},
			_count: { select: { properties: true } },
		},
	});

	const total = await prisma.ownerProfile.count({
		where: { AND: andConditions },
	});

	return {
		data: owners,
		meta: {
			page,
			limit,
			total,
			totalPages: Math.ceil(total / limit),
		},
	};
};

// Remove a previously uploaded document
const removeVerificationDocument = async (
	user: RequestUser,
	publicId: string,
) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const existingDocuments = (ownerProfile.documents as TDocument[]) || [];
	const targetDocument = existingDocuments.find(
		(doc) => doc.publicId === publicId,
	);

	if (!targetDocument) {
		throw new AppError(httpStatus.NOT_FOUND, "Document not found");
	}

	const documents = existingDocuments.filter(
		(doc) => doc.publicId !== publicId,
	);

	await prisma.ownerProfile.update({
		where: { id: ownerProfile.id },
		data: { documents: documents as any },
	});

	// the asset belonged to this profile, so it is safe to purge from cloudinary
	await deleteFromCloudinary(publicId);

	return documents;
};

export const OwnerServices = {
	verifyOwnerProfile,
	uploadVerificationDocuments,
	requestVerification,
	updateMyOwnerProfile,
	getMyOwnerProfile,
	getAllOwners,
	removeVerificationDocument,
};
