import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ApplicationController } from "./application.controller";
import { ApplicationValidation } from "./application.validation";

const router = Router();

// Apply for a room - TENANT
router.post(
	"/apply",
	auth(Role.TENANT),
	validateRequest(ApplicationValidation.ApplyForRoomZodSchema),
	ApplicationController.applyForRoom,
);

// My applications - TENANT
router.get(
	"/my-applications",
	auth(Role.TENANT),
	ApplicationController.getMyApplications,
);

// Applications on my rooms - OWNER
router.get(
	"/owner-applications",
	auth(Role.OWNER),
	ApplicationController.getOwnerApplications,
);

// Single application detail (tenant/owner/admin)
router.get(
	"/:applicationId",
	auth(Role.TENANT, Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	ApplicationController.getApplicationDetail,
);

// Review (approve/reject) an application - OWNER
router.patch(
	"/:applicationId/review",
	auth(Role.OWNER),
	validateRequest(ApplicationValidation.ReviewApplicationZodSchema),
	ApplicationController.reviewApplication,
);

// Pay the booking deposit (bKash) - TENANT
router.post(
	"/:applicationId/pay-deposit",
	auth(Role.TENANT),
	ApplicationController.payDeposit,
);

// Cancel an application - TENANT / ADMIN
router.post(
	"/:applicationId/cancel",
	auth(Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN),
	ApplicationController.cancelApplication,
);

export const ApplicationRoutes = router;
