import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { MaintenanceController } from "./maintenance.controller";
import { MaintenanceValidation } from "./maintenance.validation";

const router = Router();

// Report an issue - TENANT (must have an active lease)
router.post(
	"/",
	auth(Role.TENANT),
	validateRequest(MaintenanceValidation.CreateMaintenanceRequestZodSchema),
	MaintenanceController.createMaintenanceRequest,
);

// My maintenance requests - TENANT
router.get(
	"/my-requests",
	auth(Role.TENANT),
	MaintenanceController.getMyMaintenanceRequests,
);

// Maintenance requests on my rooms - OWNER
router.get(
	"/owner-requests",
	auth(Role.OWNER),
	MaintenanceController.getOwnerMaintenanceRequests,
);

// Update request status - OWNER / ADMIN
router.patch(
	"/:requestId/status",
	auth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(MaintenanceValidation.UpdateMaintenanceStatusZodSchema),
	MaintenanceController.updateMaintenanceStatus,
);

// Attach an image - TENANT / OWNER / ADMIN
router.post(
	"/:requestId/image",
	auth(Role.TENANT, Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	upload.single("image"),
	MaintenanceController.uploadMaintenanceImage,
);

export const MaintenanceRoutes = router;
