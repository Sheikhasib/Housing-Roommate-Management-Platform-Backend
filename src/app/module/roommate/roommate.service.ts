import httpStatus from "http-status";
import {
	InvoiceType,
	LeaseStatus,
	MembershipStatus,
	NotificationType,
	RoommateRequestStatus,
	Role,
	VerificationStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type {
	RoommateMembershipWhereInput,
	RoommateRequestWhereInput,
} from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { redisClient } from "../../lib/redis";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { createNotification } from "../../utils/notification";
import type {
	IInviteMembershipPayload,
	IRemoveMembershipPayload,
	IRespondMembershipPayload,
	IRespondRoommateRequestPayload,
	ISendRoommateRequestPayload,
} from "./roommate.interface";

// P3-Lite invariant: membership is people, occupancy is beds. A lease hosts at
// most one ACTIVE roommate member alongside its holder (master plan I3).
const MAX_ACTIVE_MEMBERS_PER_LEASE = 1;

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
			isDeleted: false,
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

	// one query for all candidates (any city or none). The ranking only depends
	// on the score anyway, and SQL `not` would wrongly drop NULL-city tenants.
	const candidates = await prisma.tenantProfile.findMany({
		where: {
			isDeleted: false,
			lookingForRoommate: true,
			id: { notIn: [...excludedIds] },
		},
		include: {
			user: { select: { id: true, name: true, imageUrl: true } },
		},
	});

	const scoredCandidates = candidates
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

// Profile fields the counterparty may see before any acceptance — identical
// to the /match card, so a pending request never leaks contact details.
const trimRequestProfile = (profile: {
	id: string;
	name: string;
	occupation: string | null;
	bio: string | null;
	preferredCity: string | null;
	monthlyBudgetMax: number | null;
	moveInDate: Date | null;
	smoker: boolean;
	petFriendly: boolean;
	hasPets: boolean;
	gender: string | null;
	user: { imageUrl: string | null };
}) => ({
	id: profile.id,
	name: profile.name,
	imageUrl: profile.user.imageUrl,
	occupation: profile.occupation,
	bio: profile.bio,
	preferredCity: profile.preferredCity,
	monthlyBudgetMax: profile.monthlyBudgetMax,
	moveInDate: profile.moveInDate,
	smoker: profile.smoker,
	petFriendly: profile.petFriendly,
	hasPets: profile.hasPets,
	gender: profile.gender,
});

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

	const data = requests.map((request) => ({
		...request,
		sender: trimRequestProfile(request.sender),
		receiver: trimRequestProfile(request.receiver),
	}));

	return {
		data,
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
		// conditional write: only a still-PENDING request can be responded to,
		// so two concurrent accepts can never both pass (second → 409 below)
		const updatedCount = await tx.roommateRequest.updateMany({
			where: { id: requestId, status: RoommateRequestStatus.PENDING },
			data: {
				status: payload.status as RoommateRequestStatus,
				respondedAt: new Date(),
			},
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Roommate request is no longer pending. Please refresh and try again.",
			);
		}

		const updatedRequest = await tx.roommateRequest.findUniqueOrThrow({
			where: { id: requestId },
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

// Leave / remove a roommate pair. The underlying requests are marked DECLINED
// so the two tenants can send each other a fresh request later.
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

	const otherId =
		pair.tenantAId === myProfile.id ? pair.tenantBId : pair.tenantAId;

	await prisma.$transaction(async (tx) => {
		await tx.roommatePair.delete({
			where: { id: pairId },
		});

		// clear any ACCEPTED/PENDING request between the pair in both directions
		// so they are free to reconnect with a brand-new request
		await tx.roommateRequest.updateMany({
			where: {
				isDeleted: false,
				OR: [
					{ senderId: myProfile.id, receiverId: otherId },
					{ senderId: otherId, receiverId: myProfile.id },
				],
			},
			data: { status: RoommateRequestStatus.DECLINED, respondedAt: new Date() },
		});
	});

	return { message: "Roommate pair removed successfully" };
};

// ---------------------------------------------------------------------------
// Post-lease roommate memberships (P3-Lite, spec 08). An invited, verified
// tenant shares the lease holder's room as an operational member: they may
// raise maintenance and view the room's utility bills. Members never enter
// money flows and never change occupancy counters. Every transition is a
// guarded write + an atomic audit row (master plan I6).
// ---------------------------------------------------------------------------

// Lease context reused by every membership transition's notifications.
const getMembershipWithLease = (membershipId: string) => {
	return prisma.roommateMembership.findUnique({
		where: { id: membershipId },
		include: {
			lease: {
				select: {
					id: true,
					roomId: true,
					status: true,
					tenantProfileId: true,
					tenantProfile: {
						include: { user: { select: { imageUrl: true } } },
					},
					room: {
						select: {
							id: true,
							name: true,
							monthlyRent: true,
							property: {
								select: {
									id: true,
									title: true,
									city: true,
									owner: { select: { userId: true } },
								},
							},
						},
					},
				},
			},
			tenantProfile: {
				include: { user: { select: { imageUrl: true } } },
			},
		},
	});
};

// HOLDER: invite a verified tenant to share their active lease's room.
// Re-invites after a terminal state (REJECTED/REMOVED) re-arm the same row.
const inviteMember = async (
	payload: IInviteMembershipPayload,
	user: RequestUser,
) => {
	const holderProfile = await getTenantProfile(user.userId);

	const lease = await prisma.lease.findUnique({
		where: { id: payload.leaseId },
		include: { room: { select: { name: true } } },
	});

	if (!lease || lease.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Lease not found");
	}

	if (lease.status !== LeaseStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			"You can only invite roommates to an active lease",
		);
	}

	if (lease.tenantProfileId !== holderProfile.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only invite roommates to your own active lease",
		);
	}

	const inviteeEmail = payload.tenantEmail.trim().toLowerCase();

	if (inviteeEmail === holderProfile.email.toLowerCase()) {
		throw new AppError(httpStatus.BAD_REQUEST, "You cannot invite yourself");
	}

	const inviteeProfile = await prisma.tenantProfile.findFirst({
		where: { email: inviteeEmail, isDeleted: false },
	});

	if (!inviteeProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant not found");
	}

	if (inviteeProfile.verificationStatus !== VerificationStatus.APPROVED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Invited tenant is not verified yet",
		);
	}

	// a live (PENDING/ACTIVE) membership on this lease cannot be duplicated
	const existingMembership = await prisma.roommateMembership.findUnique({
		where: {
			unique_membership_per_lease: {
				leaseId: lease.id,
				tenantProfileId: inviteeProfile.id,
			},
		},
	});

	if (
		existingMembership &&
		(existingMembership.status === MembershipStatus.PENDING ||
			existingMembership.status === MembershipStatus.ACTIVE)
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This tenant already has a live membership on this lease",
		);
	}

	// the room already has an active roommate member
	const activeMembers = await prisma.roommateMembership.count({
		where: { leaseId: lease.id, status: MembershipStatus.ACTIVE },
	});

	if (activeMembers >= MAX_ACTIVE_MEMBERS_PER_LEASE) {
		throw new AppError(
			httpStatus.CONFLICT,
			"This room already has an active roommate member",
		);
	}

	// a tenant already renting this room under their own lease cannot join
	const inviteeLeaseOnRoom = await prisma.lease.findFirst({
		where: {
			roomId: lease.roomId,
			tenantProfileId: inviteeProfile.id,
			status: LeaseStatus.ACTIVE,
			isDeleted: false,
		},
	});

	if (inviteeLeaseOnRoom) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Invited tenant already holds an active lease on this room",
		);
	}

	const membership = await prisma.$transaction(async (tx) => {
		// upsert on the unique pair: a terminal row is reset to PENDING
		// (history lives in the audit log, not in duplicated rows)
		const saved = await tx.roommateMembership.upsert({
			where: {
				unique_membership_per_lease: {
					leaseId: lease.id,
					tenantProfileId: inviteeProfile.id,
				},
			},
			create: {
				leaseId: lease.id,
				tenantProfileId: inviteeProfile.id,
				message: payload.message,
				status: MembershipStatus.PENDING,
			},
			update: {
				status: MembershipStatus.PENDING,
				message: payload.message,
				respondedAt: null,
				joinedAt: null,
				removedAt: null,
				removedBy: null,
				removalReason: null,
			},
		});

		await writeAuditLog(
			{
				action: "MEMBERSHIP_INVITED",
				entity: "RoommateMembership",
				entityId: saved.id,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: existingMembership
					? { status: existingMembership.status }
					: null,
				after: { status: MembershipStatus.PENDING },
			},
			tx,
		);

		return saved;
	});

	// side effects after commit, fail-soft
	try {
		await createNotification({
			userId: inviteeProfile.userId,
			type: NotificationType.ROOMMATE,
			title: "Roommate invitation 🏠",
			message: `${holderProfile.name} invited you to share their room "${lease.room.name}".`,
			data: { membershipId: membership.id, leaseId: lease.id },
		});
	} catch (error) {
		console.log("Membership invite notification failed:", error);
	}

	return membership;
};

// TENANT: memberships where I am the holder or the invited member
const getMyMemberships = async (user: RequestUser, query: IQuery) => {
	const myProfile = await getTenantProfile(user.userId);

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: RoommateMembershipWhereInput[] = [
		{
			OR: [
				{ tenantProfileId: myProfile.id },
				{ lease: { tenantProfileId: myProfile.id } },
			],
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status as MembershipStatus });
	}

	const memberships = await prisma.roommateMembership.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			lease: {
				select: {
					id: true,
					startDate: true,
					endDate: true,
					status: true,
					roomId: true,
					tenantProfileId: true,
					tenantProfile: {
						include: { user: { select: { imageUrl: true } } },
					},
					room: {
						select: {
							id: true,
							name: true,
							monthlyRent: true,
							property: { select: { id: true, title: true, city: true } },
						},
					},
				},
			},
			tenantProfile: {
				include: { user: { select: { imageUrl: true } } },
			},
		},
	});

	const total = await prisma.roommateMembership.count({
		where: { AND: andConditions },
	});

	// role-aware projection: contacts only via the trimmed match-card shape
	const data = memberships.map((membership) => ({
		id: membership.id,
		status: membership.status,
		message: membership.message,
		respondedAt: membership.respondedAt,
		joinedAt: membership.joinedAt,
		removedAt: membership.removedAt,
		removedBy: membership.removedBy,
		removalReason: membership.removalReason,
		createdAt: membership.createdAt,
		role:
			membership.lease.tenantProfileId === myProfile.id ? "HOLDER" : "MEMBER",
		lease: {
			id: membership.lease.id,
			startDate: membership.lease.startDate,
			endDate: membership.lease.endDate,
			status: membership.lease.status,
		},
		room: membership.lease.room,
		holder: trimRequestProfile(membership.lease.tenantProfile),
		member: trimRequestProfile(membership.tenantProfile),
	}));

	return {
		data,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// INVITEE: accept or decline a PENDING invitation. Accepting re-checks the
// active-member cap INSIDE the transaction, so a racing accept on another
// invitation loses cleanly (409).
const respondToMembership = async (
	membershipId: string,
	payload: IRespondMembershipPayload,
	user: RequestUser,
) => {
	const myProfile = await getTenantProfile(user.userId);

	const membership = await getMembershipWithLease(membershipId);

	if (!membership) {
		throw new AppError(httpStatus.NOT_FOUND, "Membership not found");
	}

	if (membership.tenantProfileId !== myProfile.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only the invited tenant can respond",
		);
	}

	if (membership.status !== MembershipStatus.PENDING) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Membership has already been ${membership.status.toLowerCase()}`,
		);
	}

	const isAccept = payload.action === "ACCEPT";

	const updatedMembership = await prisma.$transaction(async (tx) => {
		if (isAccept) {
			// cap re-check inside the same transaction as the write
			const activeMembers = await tx.roommateMembership.count({
				where: {
					leaseId: membership.leaseId,
					status: MembershipStatus.ACTIVE,
				},
			});

			if (activeMembers >= MAX_ACTIVE_MEMBERS_PER_LEASE) {
				throw new AppError(
					httpStatus.CONFLICT,
					"This room already has an active roommate member",
				);
			}
		}

		const updatedCount = await tx.roommateMembership.updateMany({
			where: { id: membershipId, status: MembershipStatus.PENDING },
			data: isAccept
				? {
						status: MembershipStatus.ACTIVE,
						respondedAt: new Date(),
						joinedAt: new Date(),
						removedAt: null,
						removedBy: null,
						removalReason: null,
					}
				: {
						status: MembershipStatus.REJECTED,
						respondedAt: new Date(),
					},
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Membership is no longer pending. Please refresh and try again.",
			);
		}

		const updated = await tx.roommateMembership.findUniqueOrThrow({
			where: { id: membershipId },
		});

		await writeAuditLog(
			{
				action: isAccept ? "MEMBERSHIP_ACCEPTED" : "MEMBERSHIP_DECLINED",
				entity: "RoommateMembership",
				entityId: membershipId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: MembershipStatus.PENDING },
				after: {
					status: isAccept
						? MembershipStatus.ACTIVE
						: MembershipStatus.REJECTED,
				},
			},
			tx,
		);

		return updated;
	});

	// side effects after commit, fail-soft
	try {
		await createNotification({
			userId: membership.lease.tenantProfile.userId,
			type: NotificationType.ROOMMATE,
			title: isAccept ? "Roommate joined 🎉" : "Roommate invitation declined",
			message: isAccept
				? `${membership.tenantProfile.name} accepted your invitation and joined "${membership.lease.room.name}".`
				: `${membership.tenantProfile.name} declined your roommate invitation.`,
			data: { membershipId, leaseId: membership.leaseId },
		});

		if (isAccept) {
			// the owner can never be blindsided by a new occupant
			await createNotification({
				userId: membership.lease.room.property.owner.userId,
				type: NotificationType.ROOMMATE,
				title: "Roommate joined 🎉",
				message: `${membership.tenantProfile.name} joined "${membership.lease.room.name}" as a roommate of ${membership.lease.tenantProfile.name}.`,
				data: { membershipId, leaseId: membership.leaseId },
			});
		}
	} catch (error) {
		console.log("Membership respond notification failed:", error);
	}

	return updatedMembership;
};

// HOLDER or MEMBER: end an ACTIVE membership ("leave")
const leaveMembership = async (membershipId: string, user: RequestUser) => {
	const myProfile = await getTenantProfile(user.userId);

	const membership = await getMembershipWithLease(membershipId);

	if (!membership) {
		throw new AppError(httpStatus.NOT_FOUND, "Membership not found");
	}

	const isHolder = membership.lease.tenantProfileId === myProfile.id;
	const isMember = membership.tenantProfileId === myProfile.id;

	if (!isHolder && !isMember) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Only membership participants can end it",
		);
	}

	if (membership.status !== MembershipStatus.ACTIVE) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Membership is not active (status: ${membership.status.toLowerCase()})`,
		);
	}

	const updatedMembership = await prisma.$transaction(async (tx) => {
		const updatedCount = await tx.roommateMembership.updateMany({
			where: { id: membershipId, status: MembershipStatus.ACTIVE },
			data: {
				status: MembershipStatus.REMOVED,
				removedAt: new Date(),
				removedBy: user.userId,
				removalReason: "left",
			},
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Membership is no longer active. Please refresh and try again.",
			);
		}

		const updated = await tx.roommateMembership.findUniqueOrThrow({
			where: { id: membershipId },
		});

		await writeAuditLog(
			{
				action: "MEMBERSHIP_REMOVED",
				entity: "RoommateMembership",
				entityId: membershipId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: MembershipStatus.ACTIVE },
				after: { status: MembershipStatus.REMOVED, reason: "left" },
			},
			tx,
		);

		return updated;
	});

	// notify the other party + the owner (fail-soft, never the actor themself)
	try {
		const otherUserId = isHolder
			? membership.tenantProfile.userId
			: membership.lease.tenantProfile.userId;

		await createNotification({
			userId: otherUserId,
			type: NotificationType.ROOMMATE,
			title: "Roommate left 🚪",
			message: isHolder
				? `${membership.lease.tenantProfile.name} ended the roommate arrangement for "${membership.lease.room.name}".`
				: `${membership.tenantProfile.name} left "${membership.lease.room.name}".`,
			data: { membershipId, leaseId: membership.leaseId },
		});

		await createNotification({
			userId: membership.lease.room.property.owner.userId,
			type: NotificationType.ROOMMATE,
			title: "Roommate left 🚪",
			message: `The roommate arrangement on "${membership.lease.room.name}" has ended.`,
			data: { membershipId, leaseId: membership.leaseId },
		});
	} catch (error) {
		console.log("Membership leave notification failed:", error);
	}

	return updatedMembership;
};

// HOLDER / property OWNER / assigned MANAGER / ADMIN: remove a PENDING or
// ACTIVE membership (safety valve for the property side).
const removeMembership = async (
	membershipId: string,
	payload: IRemoveMembershipPayload,
	user: RequestUser,
) => {
	const membership = await getMembershipWithLease(membershipId);

	if (!membership) {
		throw new AppError(httpStatus.NOT_FOUND, "Membership not found");
	}

	const isHolder =
		user.role === Role.TENANT &&
		membership.lease.tenantProfile.userId === user.userId;
	const isOwner =
		user.role === Role.OWNER &&
		membership.lease.room.property.owner.userId === user.userId;
	const isAdmin = user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN;

	// an assigned manager may act on memberships inside their properties
	let isAssignedManager = false;
	if (user.role === Role.PROPERTY_MANAGER) {
		const assignment = await prisma.propertyManager.findFirst({
			where: {
				propertyId: membership.lease.room.property.id,
				manager: { userId: user.userId, isDeleted: false },
			},
		});
		isAssignedManager = Boolean(assignment);
	}

	if (!isHolder && !isOwner && !isAssignedManager && !isAdmin) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to remove this membership",
		);
	}

	if (
		membership.status !== MembershipStatus.PENDING &&
		membership.status !== MembershipStatus.ACTIVE
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Membership has already been ${membership.status.toLowerCase()}`,
		);
	}

	const reason = payload.reason || "Removed by property side";

	const updatedMembership = await prisma.$transaction(async (tx) => {
		const updatedCount = await tx.roommateMembership.updateMany({
			where: {
				id: membershipId,
				status: { in: [MembershipStatus.PENDING, MembershipStatus.ACTIVE] },
			},
			data: {
				status: MembershipStatus.REMOVED,
				removedAt: new Date(),
				removedBy: user.userId,
				removalReason: reason,
			},
		});

		if (updatedCount.count === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Membership was already resolved by another request",
			);
		}

		const updated = await tx.roommateMembership.findUniqueOrThrow({
			where: { id: membershipId },
		});

		await writeAuditLog(
			{
				action: "MEMBERSHIP_REMOVED",
				entity: "RoommateMembership",
				entityId: membershipId,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: { status: membership.status },
				after: { status: MembershipStatus.REMOVED, reason },
			},
			tx,
		);

		return updated;
	});

	// notify the invitee + owner (fail-soft, never the actor themself)
	try {
		if (membership.tenantProfile.userId !== user.userId) {
			await createNotification({
				userId: membership.tenantProfile.userId,
				type: NotificationType.ROOMMATE,
				title: "Roommate membership removed 🚪",
				message: `Your roommate membership on "${membership.lease.room.name}" was removed. Reason: ${reason}`,
				data: { membershipId, leaseId: membership.leaseId },
			});
		}

		const ownerUserId = membership.lease.room.property.owner.userId;
		if (ownerUserId !== user.userId) {
			await createNotification({
				userId: ownerUserId,
				type: NotificationType.ROOMMATE,
				title: "Roommate membership removed 🚪",
				message: `The roommate arrangement on "${membership.lease.room.name}" was removed by ${user.name}.`,
				data: { membershipId, leaseId: membership.leaseId },
			});
		}
	} catch (error) {
		console.log("Membership remove notification failed:", error);
	}

	return updatedMembership;
};

// MEMBER (ACTIVE) or HOLDER: the room's utility bills — a deliberately
// trimmed projection: no payment data, no lease economics, no tenant PII
// beyond what the caller already owns (master plan I1, read side).
const getMembershipUtilityBills = async (
	membershipId: string,
	user: RequestUser,
) => {
	const myProfile = await getTenantProfile(user.userId);

	const membership = await prisma.roommateMembership.findUnique({
		where: { id: membershipId },
		include: { lease: { select: { roomId: true, tenantProfileId: true } } },
	});

	if (!membership) {
		throw new AppError(httpStatus.NOT_FOUND, "Membership not found");
	}

	const isMember =
		membership.tenantProfileId === myProfile.id &&
		membership.status === MembershipStatus.ACTIVE;
	const isHolder = membership.lease.tenantProfileId === myProfile.id;

	if (!isMember && !isHolder) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to view these bills",
		);
	}

	return prisma.invoice.findMany({
		where: {
			roomId: membership.lease.roomId,
			type: InvoiceType.UTILITY,
			isDeleted: false,
		},
		orderBy: { periodStart: "desc" },
		select: {
			id: true,
			periodStart: true,
			periodEnd: true,
			dueDate: true,
			amount: true,
			status: true,
			description: true,
		},
	});
};

export const RoommateServices = {
	getMyRoommateMatches,
	sendRoommateRequest,
	getMyRoommateRequests,
	respondToRoommateRequest,
	getMyRoommatePairs,
	removeRoommatePair,
	inviteMember,
	getMyMemberships,
	respondToMembership,
	leaveMembership,
	removeMembership,
	getMembershipUtilityBills,
};
