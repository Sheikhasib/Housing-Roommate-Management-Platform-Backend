import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ViewingController } from "./viewing.controller";
import { ViewingValidation } from "./viewing.validation";

const router = Router();

// Request a room viewing - TENANT
router.post(
	"/",
	auth(Role.TENANT),
	validateRequest(ViewingValidation.CreateViewingRequestZodSchema),
	ViewingController.createViewingRequest,
);

// My viewing requests - TENANT
router.get(
	"/my-requests",
	auth(Role.TENANT),
	ViewingController.getMyViewingRequests,
);

// Viewing requests on my rooms - OWNER
router.get(
	"/owner-requests",
	auth(Role.OWNER),
	ViewingController.getOwnerViewingRequests,
);

// Cancel my viewing request - TENANT
router.post(
	"/:requestId/cancel",
	auth(Role.TENANT),
	ViewingController.cancelViewingRequest,
);

// Update viewing status - OWNER / ADMIN
router.patch(
	"/:requestId/status",
	auth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(ViewingValidation.UpdateViewingStatusZodSchema),
	ViewingController.updateViewingStatus,
);

export const ViewingRoutes = router;
