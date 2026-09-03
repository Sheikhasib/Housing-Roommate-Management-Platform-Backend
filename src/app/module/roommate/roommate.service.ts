import httpStatus from "http-status";
import {
	NotificationType,
	RoommateRequestStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { RoommateRequestWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotification } from "../../utils/notification";
import type {
	IRespondRoommateRequestPayload,
	ISendRoommateRequestPayload,
} from "./roommate.interface";

// Resolve the tenant profile of a logged-in TENANT user
const getTenantProfile = async (userId: string) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	return tenantProfile;
};

// Compute a simple compatibility score (0-100) between two tenant profiles.
const computeMatchScore = (a: any, b: any): number => {
	let score = 0;

	// location matters the most
	if (a.preferredCity && b.preferredCity) {
		if (a.preferredCity.toLowerCase() === b.preferredCity.toLowerCase()) {
			score += 30;
		}
	}

	// budget overlap
	if (a.monthlyBudgetMax && b.monthlyBudgetMax) {
		const overlap =
			Math.min(a.monthlyBudgetMax, b.monthlyBudgetMax) /
			Math.max(a.monthlyBudgetMax, b.monthlyBudgetMax);
		score += Math.round(25 * overlap);
	}

	// smoking: same lifestyle is better
	if (a.smoker === b.smoker) {
		score += 15;
	}

	// pet friendliness & existing pets
	if (a.petFriendly && b.petFriendly) {
		score += 10;
	}
	if (a.hasPets && b.hasPets) {
		score += 5;
	}
	// hard mismatch: someone with pets living with someone who can't accept pets
	if ((a.hasPets && !b.petFriendly) || (b.hasPets && !a.petFriendly)) {
		score -= 30;
	}

	// similar move-in dates (within ~45 days) are convenient
	if (a.moveInDate && b.moveInDate) {
		const diffDays = Math.abs(
			(new Date(a.moveInDate).getTime() - new Date(b.moveInDate).getTime()) /
				(1000 * 60 * 60 * 24),
		);
		if (diffDays <= 45) {
			score += 15;
		}
	}

	return Math.max(0, Math.min(100, score));
};

// Find compatible roommates for the logged-in tenant.
// Only tenants who are currently looking for a roommate are discoverable.
const getMyRoommateMatches = async (user: RequestUser) => {
	const myProfile = await getTenantProfile(user.userId);

	const cacheKey = `roommate-match:${myProfile.id}`;

	// serve from cache when possible (results only change when profiles do)
	try {
		const cached = await redisClient.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}
	} catch (error) {
		console.log("Redis cache read failed (roommate match):", error);
	}

	// exclude myself & tenants I already paired with / already asked
	const existingRelations = await prisma.roommateRequest.findMany({
		where: {
			OR: [
				{
					senderId: myProfile.id,
					status: { not: RoommateRequestStatus.DECLINED },
				},
				{
					receiverId: myProfile.id,
					status: { not: RoommateRequestStatus.DECLINED },
				},
			],
		},
		select: { senderId: true, receiverId: true },
	});

	const myPairs = await prisma.roommatePair.findMany({
		where: { OR: [{ tenantAId: myProfile.id }, { tenantBId: myProfile.id }] },
		select: { tenantAId: true, tenantBId: true },
	});

	const excludedIds = new Set<string>([myProfile.id]);

	existingRelations.forEach((rel) => {
		excludedIds.add(rel.senderId);
		excludedIds.add(rel.receiverId);
	});
	myPairs.forEach((pair) => {
		excludedIds.add(pair.tenantAId);
		excludedIds.add(pair.tenantBId);
	});

	const candidates = await prisma.tenantProfile.findMany({
		where: {
			isDeleted: false,
			lookingForRoommate: true,
			id: { notIn: [...excludedIds] },
			// prefer the same city when the tenant told us their preferred city
			...(myProfile.preferredCity
				? { preferredCity: myProfile.preferredCity }
				: {}),
		},
		include: {
			user: { select: { id: true, name: true, imageUrl: true } },
		},
	});

	// also consider tenants in other cities (or with no city set) but rank them lower
	const otherCandidates = myProfile.preferredCity
		? await prisma.tenantProfile.findMany({
				where: {
					isDeleted: false,
					lookingForRoommate: true,
					id: { notIn: [...excludedIds] },
					preferredCity: { not: myProfile.preferredCity },
				},
				include: {
					user: { select: { id: true, name: true, imageUrl: true } },
				},
			})
		: [];

	const scoredCandidates = [...candidates, ...otherCandidates]
		.map((candidate) => ({
			id: candidate.id,
			name: candidate.name,
			occupation: candidate.occupation,
			bio: candidate.bio,
			preferredCity: candidate.preferredCity,
			monthlyBudgetMax: candidate.monthlyBudgetMax,
			moveInDate: candidate.moveInDate,
			smoker: candidate.smoker,
			petFriendly: candidate.petFriendly,
			hasPets: candidate.hasPets,
			lookingForRoommate: candidate.lookingForRoommate,
			gender: candidate.gender,
			imageUrl: candidate.user.imageUrl,
			score: computeMatchScore(myProfile, candidate),
		}))
		.sort((a, b) => b.score - a.score);

	// short TTL because new profiles / requests appear often
	try {
		await redisClient.set(cacheKey, JSON.stringify(scoredCandidates), {
			expiration: { type: "EX", value: 5 * 60 },
		});
	} catch (error) {
		console.log("Redis cache write failed (roommate match):", error);
	}

	return scoredCandidates;
};

// Send a roommate request to another tenant
const sendRoommateRequest = async (
	payload: ISendRoommateRequestPayload,
	user: RequestUser,
) => {
	const senderProfile = await getTenantProfile(user.userId);

	if (payload.receiverTenantProfileId === senderProfile.id) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"You cannot send a roommate request to yourself",
		);
	}

	const receiverProfile = await prisma.tenantProfile.findFirst({
		where: { id: payload.receiverTenantProfileId, isDeleted: false },
	});

	if (!receiverProfile) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Receiver tenant profile not found",
		);
	}

	// prevent duplicates (pending or accepted requests are not allowed twice)
	const existingRequest = await prisma.roommateRequest.findFirst({
		where: {
			isDeleted: false,
			status: { not: RoommateRequestStatus.DECLINED },
			OR: [
				{ senderId: senderProfile.id, receiverId: receiverProfile.id },
				{ senderId: receiverProfile.id, receiverId: senderProfile.id },
			],
		},
	});

	if (existingRequest) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A roommate request already exists between you and this tenant",
		);
	}

	const request = await prisma.roommateRequest.create({
		data: {
			senderId: senderProfile.id,
			receiverId: receiverProfile.id,
			message: payload.message,
			status: RoommateRequestStatus.PENDING,
		},
	});

	await createNotification({
		userId: receiverProfile.userId,
		type: NotificationType.SYSTEM,
		title: "New roommate request 🙋",
		message: `${senderProfile.name} wants to be your roommate.`,
		data: { requestId: request.id, senderTenantProfileId: senderProfile.id },
	});

	return request;
};

// List requests I sent or received
const getMyRoommateRequests = async (user: RequestUser, query: IQuery) => {
	const myProfile = await getTenantProfile(user.userId);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: RoommateRequestWhereInput[] = [
		{ isDeleted: false },
		{
			OR: [{ senderId: myProfile.id }, { receiverId: myProfile.id }],
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}

	const requests = await prisma.roommateRequest.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			sender: {
				include: { user: { select: { id: true, name: true, imageUrl: true } } },
			},
			receiver: {
				include: { user: { select: { id: true, name: true, imageUrl: true } } },
			},
		},
	});

	const total = await prisma.roommateRequest.count({
		where: { AND: andConditions },
	});

	return {
		data: requests,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Accept / decline an incoming roommate request
const respondToRoommateRequest = async (
	requestId: string,
	payload: IRespondRoommateRequestPayload,
	user: RequestUser,
) => {
	const myProfile = await getTenantProfile(user.userId);

	const request = await prisma.roommateRequest.findUnique({
		where: { id: requestId },
		include: { sender: true, receiver: true },
	});

	if (!request || request.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Roommate request not found");
	}

	// only the receiver can respond
	if (request.receiverId !== myProfile.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You cannot respond to this roommate request",
		);
	}

	if (request.status !== RoommateRequestStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Roommate request has already been ${request.status.toLowerCase()}`,
		);
	}

	const transactionResult = await prisma.$transaction(async (tx) => {
		const updatedRequest = await tx.roommateRequest.update({
			where: { id: requestId },
			data: {
				status: payload.status as RoommateRequestStatus,
				respondedAt: new Date(),
			},
		});

		// acceptance creates the formal pair
		if (payload.status === "ACCEPTED") {
			const [tenantAId, tenantBId] = [
				request.senderId,
				request.receiverId,
			].sort();

			const existingPair = await tx.roommatePair.findFirst({
				where: {
					OR: [
						{ tenantAId, tenantBId },
						{ tenantAId: tenantBId, tenantBId: tenantAId },
					],
				},
			});

			if (!existingPair) {
				await tx.roommatePair.create({
					data: { tenantAId, tenantBId },
				});
			}
		}

		return updatedRequest;
	});

	await createNotification({
		userId: request.sender.userId,
		type: NotificationType.SYSTEM,
		title:
			payload.status === "ACCEPTED"
				? "Roommate request accepted ✅"
				: "Roommate request declined",
		message:
			payload.status === "ACCEPTED"
				? `${request.receiver.name} accepted your roommate request. You are now roommates!`
				: `${request.receiver.name} declined your roommate request.`,
		data: { requestId },
	});

	return transactionResult;
};

// List current roommate pairs
const getMyRoommatePairs = async (user: RequestUser) => {
	const myProfile = await getTenantProfile(user.userId);

	const pairs = await prisma.roommatePair.findMany({
		where: { OR: [{ tenantAId: myProfile.id }, { tenantBId: myProfile.id }] },
		include: {
			tenantA: {
				include: { user: { select: { id: true, name: true, imageUrl: true } } },
			},
			tenantB: {
				include: { user: { select: { id: true, name: true, imageUrl: true } } },
			},
		},
		orderBy: { createdAt: "desc" },
	});

	// shape each pair so the caller always sees the "other" roommate
	const data = pairs.map((pair) => ({
		id: pair.id,
		createdAt: pair.createdAt,
		meTenantProfileId: myProfile.id,
		roommate:
			pair.tenantAId === myProfile.id
				? {
						tenantProfileId: pair.tenantBId,
						name: pair.tenantB.name,
						imageUrl: pair.tenantB.user.imageUrl,
						occupation: pair.tenantB.occupation,
					}
				: {
						tenantProfileId: pair.tenantAId,
						name: pair.tenantA.name,
						imageUrl: pair.tenantA.user.imageUrl,
						occupation: pair.tenantA.occupation,
					},
	}));

	return data;
};

// Leave / remove a roommate pair
const removeRoommatePair = async (pairId: string, user: RequestUser) => {
	const myProfile = await getTenantProfile(user.userId);

	const pair = await prisma.roommatePair.findFirst({
		where: {
			id: pairId,
			OR: [{ tenantAId: myProfile.id }, { tenantBId: myProfile.id }],
		},
	});

	if (!pair) {
		throw new AppError(httpStatus.NOT_FOUND, "Roommate pair not found");
	}

	await prisma.roommatePair.delete({
		where: { id: pairId },
	});

	return { message: "Roommate pair removed successfully" };
};

export const RoommateServices = {
	getMyRoommateMatches,
	sendRoommateRequest,
	getMyRoommateRequests,
	respondToRoommateRequest,
	getMyRoommatePairs,
	removeRoommatePair,
};
