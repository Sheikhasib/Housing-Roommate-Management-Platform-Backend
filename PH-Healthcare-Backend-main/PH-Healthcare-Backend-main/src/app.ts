import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
  NextFunction,
  type Application,
  type Request,
  type Response,
} from "express";
import httpStatus from "http-status";
import config from "./app/config";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";
import z from "zod";
import { redisClient } from "./app/lib/redis";
import crypto from "crypto";
import { UserRoutes } from "./app/module/user/user.route";
import { getBkashIdToken } from "./app/lib/bKash";
import { AppointmentRoutes } from "./app/module/appointment/appointment.route";
import { DoctorRoutes } from "./app/module/doctor/doctor.route";
import { ScheduleRoutes } from "./app/module/schedule/schedule.route";
import { PaymentRoutes } from "./app/module/payment/payment.route";
import { PrescriptionRoutes } from "./app/module/prescription/prescription.route";
import { AnalyticsRoutes } from "./app/module/analytics/analytics.route";

const app: Application = express();

app.use(
  cors({
    origin: config.frontend_url,
    credentials: true,
  }),
);

// Enable URL-encoded form data parsing
app.use(express.urlencoded({ extended: true }));

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

// Basic route
app.get("/", async (req: Request, res: Response) => {
  res.status(httpStatus.OK).json({
    success: true,
    message: "Welcome to PH Healthcare System Backend",
  });
});

// Auth routes
app.use("/api/v1/auth", AuthRoutes);

// User routes
app.use("/api/v1/user", UserRoutes);

// Appointment routes
app.use("/api/v1/appointment", AppointmentRoutes);

// Doctor routes
app.use("/api/v1/doctor", DoctorRoutes);

// Schedule routes
app.use("/api/v1/schedule", ScheduleRoutes);

// Payment routes
app.use("/api/v1/payment", PaymentRoutes);

// Prescription routes
app.use("/api/v1/prescription", PrescriptionRoutes);

// Analytics routes
app.use("/api/v1/analytics", AnalyticsRoutes);

app.get("/test", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const grantIdToken = await getBkashIdToken();
    console.log(grantIdToken);

    res.status(httpStatus.OK).json({
      success: true,
      message: "Zod validation successful",
      data: null,
    });
  } catch (error) {
    next(error);
  }
});

app.use(globalErrorHandler);
app.use(notFound);

export default app;
