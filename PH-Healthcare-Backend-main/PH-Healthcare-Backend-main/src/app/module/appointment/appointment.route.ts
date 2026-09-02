import { Router } from "express";
import { AppointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";
import { validateRequest } from "../../middleware/validateRequest";
import {
  BookAppointmentValidationZodSchema,
  UpdateAppointmentStatusValidationZodSchema,
} from "./appointment.validation";

const router = Router();

// Book Appointment route
router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  validateRequest(BookAppointmentValidationZodSchema),
  AppointmentController.bookAppointment,
);

// Pay Appointment route
router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  AppointmentController.payAppointment,
);

// Book Appointment Callback URL route(bKash)
router.get(
  "/book-appointment/payment/callback",
  AppointmentController.bookAppointmentCallback,
);

// Cancel Appointment route
router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.cancelAppointment,
);

// Update Appointment Status by appointmentId
router.patch(
  "/update-status/:appointmentId",
  auth(Role.DOCTOR),
  validateRequest(UpdateAppointmentStatusValidationZodSchema),
  AppointmentController.updateAppointmentStatus,
);

// Get my appointments(Patient)
router.get(
  "/my-appointments",
  auth(Role.PATIENT),
  AppointmentController.getMyAppointments,
);

// Get my appointments(Doctor)
router.get(
  "/doctor-appointments",
  auth(Role.DOCTOR),
  AppointmentController.getDoctorAppointments,
);

// Get all appointments
router.get(
  "/all-appointments",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getAllAppointments,
);

// Get Single Appointment by Id
router.get(
  "/:appointmentId",
  auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.getSingleAppointment,
);

export const AppointmentRoutes = router;
