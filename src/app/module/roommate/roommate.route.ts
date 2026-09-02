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

export const RoommateRoutes = router;
