import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PrescriptionController } from "./prescription.controller";
import { CreatePrescriptionValidationZodSchema } from "./prescription.validation";

const router = Router();

// Create Prescription route
router.post(
  "/create-prescription",
  auth(Role.DOCTOR),
  validateRequest(CreatePrescriptionValidationZodSchema),
  PrescriptionController.createPrescription,
);

// Get Single Prescription by Id
router.get(
  "/:appointmentId",
  auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
  PrescriptionController.getSinglePrescription,
);

export const PrescriptionRoutes = router;
