import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { RoommateController } from "./roommate.controller";
import { RoommateValidation } from "./roommate.validation";

const router = Router();

// Get ranked roommate matches - TENANT
router.get(
	"/match",
	auth(Role.TENANT),
	RoommateController.getMyRoommateMatches,
);

// Send roommate request - TENANT
router.post(
	"/request",
	auth(Role.TENANT),
	validateRequest(RoommateValidation.SendRoommateRequestZodSchema),
	RoommateController.sendRoommateRequest,
);

// My roommate requests (sent & received) - TENANT
router.get(
	"/my-requests",
	auth(Role.TENANT),
	RoommateController.getMyRoommateRequests,
);

// Respond to a roommate request - TENANT (receiver only)
router.patch(
	"/request/:requestId/respond",
	auth(Role.TENANT),
	validateRequest(RoommateValidation.RespondRoommateRequestZodSchema),
	RoommateController.respondToRoommateRequest,
);

// Current roommate pairs - TENANT
router.get(
	"/my-pairs",
	auth(Role.TENANT),
	RoommateController.getMyRoommatePairs,
);

// Remove a roommate pair - TENANT
router.delete(
	"/pair/:pairId",
	auth(Role.TENANT),
	RoommateController.removeRoommatePair,
);

// ---------------- Post-lease memberships (P3-Lite, spec 08) ----------------

// Invite a tenant to share my active lease's room - TENANT (holder)
router.post(
	"/memberships/invite",
	auth(Role.TENANT),
	validateRequest(RoommateValidation.InviteMembershipZodSchema),
	RoommateController.inviteMember,
);

// My memberships (holder or invited member) - TENANT
router.get(
	"/memberships/my",
	auth(Role.TENANT),
	RoommateController.getMyMemberships,
);

// The room's utility bills for a membership - TENANT (member/holder)
router.get(
	"/memberships/:membershipId/utility-bills",
	auth(Role.TENANT),
	RoommateController.getMembershipUtilityBills,
);

// Respond to a membership invitation - TENANT (invitee)
router.patch(
	"/memberships/:membershipId/respond",
	auth(Role.TENANT),
	validateRequest(RoommateValidation.RespondMembershipZodSchema),
	RoommateController.respondToMembership,
);

// Leave an active membership - TENANT (holder or member)
router.post(
	"/memberships/:membershipId/leave",
	auth(Role.TENANT),
	RoommateController.leaveMembership,
);

// Remove a membership - holder / property owner / assigned manager / admin
router.post(
	"/memberships/:membershipId/remove",
	auth(
		Role.TENANT,
		Role.OWNER,
		Role.PROPERTY_MANAGER,
		Role.ADMIN,
		Role.SUPER_ADMIN,
	),
	validateRequest(RoommateValidation.RemoveMembershipZodSchema),
	RoommateController.removeMembership,
);

export const RoommateRoutes = router;
