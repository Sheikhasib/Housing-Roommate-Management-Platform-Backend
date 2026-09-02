import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = Router();

// Profile image route
router.patch(
	"/profile-image",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	upload.single("profileImage"),
	UserController.uploadProfileImage,
);

// Update my display profile
router.patch(
	"/update-me",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	validateRequest(UserValidation.updateProfileZodSchema),
	UserController.updateMyProfile,
);

export const UserRoutes = router;
