import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { TenantController } from "./tenant.controller";
import { TenantValidation } from "./tenant.validation";

const router = Router();

// Get my tenant profile
router.get("/me", auth(Role.TENANT), TenantController.getMyTenantProfile);

// Update my tenant profile (incl. roommate matching preferences)
router.patch(
	"/update-me",
	auth(Role.TENANT),
	validateRequest(TenantValidation.UpdateTenantProfileZodSchema),
	TenantController.updateMyTenantProfile,
);

// Upload/replace my identity verification document
router.patch(
	"/verification-document",
	auth(Role.TENANT),
	upload.single("document"),
	TenantController.uploadVerificationDocument,
);

export const TenantRoutes = router;
