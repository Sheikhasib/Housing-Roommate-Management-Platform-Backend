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

// Maintenance requests on my rooms - OWNER / assigned MANAGER
router.get(
	"/owner-requests",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	MaintenanceController.getOwnerMaintenanceRequests,
);

// Update request status - OWNER / assigned MANAGER / ADMIN
router.patch(
	"/:requestId/status",
	auth(Role.OWNER, Role.PROPERTY_MANAGER, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(MaintenanceValidation.UpdateMaintenanceStatusZodSchema),
	MaintenanceController.updateMaintenanceStatus,
);

// Attach an image - TENANT / OWNER / assigned MANAGER / ADMIN
router.post(
	"/:requestId/image",
	auth(
		Role.TENANT,
		Role.OWNER,
		Role.PROPERTY_MANAGER,
		Role.ADMIN,
		Role.SUPER_ADMIN,
	),
	upload.single("image"),
	MaintenanceController.uploadMaintenanceImage,
);

export const MaintenanceRoutes = router;
