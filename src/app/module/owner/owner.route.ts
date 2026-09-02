import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { OwnerController } from "./owner.controller";
import { OwnerValidation } from "./owner.validation";

const router = Router();

// Get my owner profile
router.get("/me", auth(Role.OWNER), OwnerController.getMyOwnerProfile);

// Update my owner profile
router.patch(
	"/update-me",
	auth(Role.OWNER),
	validateRequest(OwnerValidation.UpdateOwnerProfileZodSchema),
	OwnerController.updateMyOwnerProfile,
);

// Upload verification documents
router.post(
	"/verification-documents",
	auth(Role.OWNER),
	upload.array("documents", 5),
	OwnerController.uploadVerificationDocuments,
);

// Remove a verification document
router.delete(
	"/verification-documents",
	auth(Role.OWNER),
	OwnerController.removeVerificationDocument,
);

// Re-submit for verification (after being rejected)
router.post(
	"/request-verification",
	auth(Role.OWNER),
	OwnerController.requestVerification,
);

// Verify (approve/reject) an owner - ADMIN
router.patch(
	"/verify",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(OwnerValidation.VerifyOwnerZodSchema),
	OwnerController.verifyOwnerProfile,
);

// Get all owners (with filters) - ADMIN
router.get(
	"/all-owners",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	OwnerController.getAllOwners,
);

export const OwnerRoutes = router;
