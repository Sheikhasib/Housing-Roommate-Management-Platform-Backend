import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { ScheduleController } from "./schedule.controller";
import {
  CreateScheduleValidationZodSchema,
  UpdateScheduleValidationZodSchema,
} from "./schedule.validation";

const router = Router();

// Create Schedule route
router.post(
  "/create-schedule",
  auth(Role.DOCTOR),
  validateRequest(CreateScheduleValidationZodSchema),
  ScheduleController.createSchedule,
);

// Get my schedules
router.get(
  "/my-schedules",
  auth(Role.DOCTOR),
  ScheduleController.getMySchedules,
);

// Get all schedules
router.get(
  "/all-schedules",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  ScheduleController.getAllSchedules,
);

// Get today's schedules
router.get("/todays-schedule", ScheduleController.getTodaysSchedules);

// Update Schedule
router.patch(
  "/update-schedule/:scheduleId",
  auth(Role.DOCTOR),
  validateRequest(UpdateScheduleValidationZodSchema),
  ScheduleController.updateSchedule,
);

// Publish Schedule
router.patch(
  "/publish-schedule/:scheduleId",
  auth(Role.DOCTOR),
  ScheduleController.publishSchedule,
);

// Get Schedule By Id
router.get(
  "/:scheduleId",
  auth(Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN),
  ScheduleController.getScheduleById,
);

// Delete Schedule
router.delete(
  "/:scheduleId",
  auth(Role.DOCTOR),
  ScheduleController.deleteSchedule,
);

export const ScheduleRoutes = router;
