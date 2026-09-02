import { Router } from "express";
import { Doc } from "zod/v4/core";
import { DoctorController } from "./doctor.controller";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { validateRequest } from "../../middleware/validateRequest";
import { UpdateDoctorProfileValidationZodSchema } from "./doctor.validation";

const router = Router();

// Apply as Doctor route
router.post(
  "/apply-as-doctor",
  upload.fields([
    {
      name: "resume",
      maxCount: 1,
    },
    {
      name: "additionalFiles",
      maxCount: 10,
    },
  ]),
  DoctorController.applyAsDoctor,
);

// Verify Doctor Email route
router.post("/verify-doctor-email", DoctorController.verifyDoctorEmail);

// Approve Doctor route
router.post(
  "/approve-doctor",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.approveDoctor,
);

// Get All Doctors route
router.get(
  "/all-doctors",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  DoctorController.getAllDoctors,
);

// Update Doctor Profile
router.patch(
  "/update-my-profile",
  auth(Role.DOCTOR),
  validateRequest(UpdateDoctorProfileValidationZodSchema),
  DoctorController.updateDoctorProfile,
);

// Public doctor-discovery routes (no auth) — meant for patients browsing before login.
// Get Available Doctors by Todays Schedule
router.get(
  "/public/available-today",
  DoctorController.getAvailableDoctorByTodaysSchedule,
);

// Get All Doctors List
router.get("/public/all-doctors", DoctorController.getAllDoctorsListPublic);

// Get Single Doctor Public Profile by Id
router.get("/public/:doctorId", DoctorController.getSingleDoctorPublicProfile);

export const DoctorRoutes = router;
