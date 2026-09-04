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

// Applications on my rooms - OWNER / assigned MANAGER
router.get(
	"/owner-applications",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	ApplicationController.getOwnerApplications,
);

// Single application detail (tenant/owner/assigned manager/admin)
router.get(
	"/:applicationId",
	auth(
		Role.TENANT,
		Role.OWNER,
		Role.PROPERTY_MANAGER,
		Role.ADMIN,
		Role.SUPER_ADMIN,
	),
	ApplicationController.getApplicationDetail,
);

// Review (approve/reject) an application - OWNER / assigned MANAGER
router.patch(
	"/:applicationId/review",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
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
