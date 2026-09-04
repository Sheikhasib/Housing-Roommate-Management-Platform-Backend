import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ManagerController } from "./manager.controller";
import { ManagerValidation } from "./manager.validation";

const router = Router();

// Get my manager profile
router.get(
	"/me",
	auth(Role.PROPERTY_MANAGER),
	ManagerController.getMyManagerProfile,
);

// Update my manager profile
router.patch(
	"/update-me",
	auth(Role.PROPERTY_MANAGER),
	validateRequest(ManagerValidation.UpdateManagerProfileZodSchema),
	ManagerController.updateMyManagerProfile,
);

// Properties I am assigned to (delegation scope)
router.get(
	"/my-properties",
	auth(Role.PROPERTY_MANAGER),
	ManagerController.getMyManagedProperties,
);

export const ManagerRoutes = router;
