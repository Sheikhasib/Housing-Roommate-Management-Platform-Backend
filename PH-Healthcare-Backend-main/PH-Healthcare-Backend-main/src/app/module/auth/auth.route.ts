import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";
import { validateRequest } from "../../middleware/validateRequest";

const router = Router();

// Register route
router.post(
  "/register",
  //   (req: Request, res: Response, next: NextFunction) => {
  //     try {
  //       // const payload = req.body ? req.body : {};
  //       const payload = req.body ?? {};

  //       const result = AuthValidation.PatientRegisterZodSchema.safeParse(payload);

  //       // Check if the validation was successful, if not, throw an error
  //       if (!result.success) {
  //         console.log(result.error);
  //         console.log(result.error.issues);

  //         throw new Error(result.error.issues[0].message);
  //       }

  //       req.body = result.data; // Assign the validated data back to req.body

  //       next();
  //     } catch (error) {
  //       next(error);
  //     }
  //   }

  validateRequest(AuthValidation.PatientRegisterZodSchema),
  AuthController.registerPatient,
);

// Verify email route
router.post(
  "/verify-email",
  validateRequest(AuthValidation.verifyPatientZodSchema),
  AuthController.verifyPatientEmail,
);

// Login route
router.post(
  "/login",
  validateRequest(AuthValidation.LoginZodSchema),
  AuthController.loginUser,
);

// Get me route
router.get(
  "/me",
  auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN),
  // validateRequest(),
  AuthController.getMe,
);

// Refresh token route
router.post("/refresh-token", AuthController.refreshToken);

// Google Login route
router.post("/google", AuthController.googleLogin);

// Forgot password route
router.post(
  "/forgot-password",
  validateRequest(AuthValidation.ForgotPasswordZodSchema),
  AuthController.forgotPassword,
);

// Reset password route
router.post(
  "/reset-password",
  validateRequest(AuthValidation.ResetPasswordZodSchema),
  AuthController.resetPassword,
);

export const AuthRoutes = router;
