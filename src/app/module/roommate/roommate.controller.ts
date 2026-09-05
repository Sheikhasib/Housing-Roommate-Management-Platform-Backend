import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { RoommateServices } from "./roommate.service";

// Get ranked roommate matches (TENANT)
const getMyRoommateMatches = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await RoommateServices.getMyRoommateMatches(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Roommate matches fetched successfully",
		data: result,
	});
});

// Send a roommate request
const sendRoommateRequest = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await RoommateServices.sendRoommateRequest(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Roommate request sent successfully",
		data: result,
	});
});

// List my roommate requests
const getMyRoommateRequests = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } = await RoommateServices.getMyRoommateRequests(
			user,
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Roommate requests fetched successfully",
			data,
			meta,
		});
	},
);

// Respond to a roommate request
const respondToRoommateRequest = catchAsync(
	async (req: Request, res: Response) => {
		const requestId = req.params.requestId as string;
		const payload = req.body;
		const user = req.user!;

		const result = await RoommateServices.respondToRoommateRequest(
			requestId,
			payload,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Roommate request updated successfully",
			data: result,
		});
	},
);

// Get my roommate pairs
const getMyRoommatePairs = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await RoommateServices.getMyRoommatePairs(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Roommate pairs fetched successfully",
		data: result,
	});
});

// Remove a roommate pair
const removeRoommatePair = catchAsync(async (req: Request, res: Response) => {
	const pairId = req.params.pairId as string;
	const user = req.user!;

	const result = await RoommateServices.removeRoommatePair(pairId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Roommate pair removed successfully",
		data: result,
	});
});

// Invite a tenant to share my active lease's room (HOLDER)
const inviteMember = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await RoommateServices.inviteMember(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Roommate invitation sent successfully",
		data: result,
	});
});

// My memberships (as holder or invited member)
const getMyMemberships = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await RoommateServices.getMyMemberships(
		user,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Memberships fetched successfully",
		data,
		meta,
	});
});

// Accept or decline a membership invitation (invitee)
const respondToMembership = catchAsync(async (req: Request, res: Response) => {
	const membershipId = req.params.membershipId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await RoommateServices.respondToMembership(
		membershipId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Membership responded successfully",
		data: result,
	});
});

// Leave an active membership (holder or member)
const leaveMembership = catchAsync(async (req: Request, res: Response) => {
	const membershipId = req.params.membershipId as string;
	const user = req.user!;

	const result = await RoommateServices.leaveMembership(membershipId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Membership ended successfully",
		data: result,
	});
});

// Remove a membership (holder / owner / assigned manager / admin)
const removeMembership = catchAsync(async (req: Request, res: Response) => {
	const membershipId = req.params.membershipId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await RoommateServices.removeMembership(
		membershipId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Membership removed successfully",
		data: result,
	});
});

// The room's utility bills for a membership (member or holder, trimmed)
const getMembershipUtilityBills = catchAsync(
	async (req: Request, res: Response) => {
		const membershipId = req.params.membershipId as string;
		const user = req.user!;

		const result = await RoommateServices.getMembershipUtilityBills(
			membershipId,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Room utility bills fetched successfully",
			data: result,
		});
	},
);

export const RoommateController = {
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
