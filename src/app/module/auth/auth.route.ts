import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { authRateLimiter } from "../../lib/rateLimiter";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

// Register route (role: TENANT | OWNER | PROPERTY_MANAGER)
router.post(
	"/register",
	authRateLimiter,
	validateRequest(AuthValidation.registerZodSchema),
	AuthController.registerUser,
);

// Verify email route
router.post(
	"/verify-email",
	authRateLimiter,
	validateRequest(AuthValidation.verifyEmailZodSchema),
	AuthController.verifyUserEmail,
);

// Login route
router.post(
	"/login",
	authRateLimiter,
	validateRequest(AuthValidation.LoginZodSchema),
	AuthController.loginUser,
);

// Logout route
router.post("/logout", auth(), AuthController.logoutUser);

// Get me route
router.get(
	"/me",
	auth(
		Role.SUPER_ADMIN,
		Role.ADMIN,
		Role.OWNER,
		Role.PROPERTY_MANAGER,
		Role.TENANT,
	),
	AuthController.getMe,
);

// Refresh token route
router.post("/refresh-token", AuthController.refreshToken);

// Google Login route
router.post(
	"/google",
	authRateLimiter,
	validateRequest(AuthValidation.GoogleLoginZodSchema),
	AuthController.googleLogin,
);

// Forgot password route
router.post(
	"/forgot-password",
	authRateLimiter,
	validateRequest(AuthValidation.ForgotPasswordZodSchema),
	AuthController.forgotPassword,
);

// Reset password route
router.post(
	"/reset-password",
	authRateLimiter,
	validateRequest(AuthValidation.ResetPasswordZodSchema),
	AuthController.resetPassword,
);

export const AuthRoutes = router;
