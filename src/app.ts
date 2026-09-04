import cookieParser from "cookie-parser";
import cors from "cors";
import express, {
	type Application,
	type Request,
	type Response,
} from "express";
import helmet from "helmet";
import httpStatus from "http-status";
import config from "./app/config";
import { generalRateLimiter } from "./app/lib/rateLimiter";
import { globalErrorHandler } from "./app/middleware/globalErrorHandler";
import { notFound } from "./app/middleware/notFound";
import { AuthRoutes } from "./app/module/auth/auth.route";
import { UserRoutes } from "./app/module/user/user.route";
import { TenantRoutes } from "./app/module/tenant/tenant.route";
import { OwnerRoutes } from "./app/module/owner/owner.route";
import { PropertyRoutes } from "./app/module/property/property.route";
import { RoomRoutes } from "./app/module/room/room.route";
import { ViewingRoutes } from "./app/module/viewing/viewing.route";
import { RoommateRoutes } from "./app/module/roommate/roommate.route";
import { ApplicationRoutes } from "./app/module/application/application.route";
import { LeaseRoutes } from "./app/module/lease/lease.route";
import { InvoiceRoutes } from "./app/module/invoice/invoice.route";
import { PaymentRoutes } from "./app/module/payment/payment.route";
import { MaintenanceRoutes } from "./app/module/maintenance/maintenance.route";
import { NotificationRoutes } from "./app/module/notification/notification.route";
import { ManagerRoutes } from "./app/module/manager/manager.route";
import { AdminRoutes } from "./app/module/admin/admin.route";
import { AnalyticsRoutes } from "./app/module/analytics/analytics.route";

const app: Application = express();

// security headers
app.use(helmet());

// CORS
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
app.get("/", (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Welcome to Housing & Roommate Management Platform Backend",
		data: {
			name: "Housing & Roommate Management Platform",
			version: "1.0.0",
			docs: `${config.backend_url}/api/v1`,
		},
	});
});

// health check
app.get("/api/v1/health", (_req: Request, res: Response) => {
	res.status(httpStatus.OK).json({
		success: true,
		statusCode: httpStatus.OK,
		message: "Server is healthy",
		data: null,
	});
});

// General API rate limiter
app.use("/api/v1", generalRateLimiter);

// Auth routes
app.use("/api/v1/auth", AuthRoutes);

// User routes
app.use("/api/v1/user", UserRoutes);

// Tenant routes
app.use("/api/v1/tenant", TenantRoutes);

// Owner routes
app.use("/api/v1/owner", OwnerRoutes);

// Property routes
app.use("/api/v1/property", PropertyRoutes);

// Room routes
app.use("/api/v1/room", RoomRoutes);

// Viewing routes
app.use("/api/v1/viewing", ViewingRoutes);

// Roommate routes
app.use("/api/v1/roommate", RoommateRoutes);

// Application routes
app.use("/api/v1/application", ApplicationRoutes);

// Lease routes
app.use("/api/v1/lease", LeaseRoutes);

// Invoice routes
app.use("/api/v1/invoice", InvoiceRoutes);

// Payment routes
app.use("/api/v1/payment", PaymentRoutes);

// Maintenance routes
app.use("/api/v1/maintenance", MaintenanceRoutes);

// Notification routes
app.use("/api/v1/notification", NotificationRoutes);

// Manager routes (delegated property operators)
app.use("/api/v1/manager", ManagerRoutes);

// Admin routes
app.use("/api/v1/admin", AdminRoutes);

// Analytics routes
app.use("/api/v1/analytics", AnalyticsRoutes);

// global error handler
app.use(globalErrorHandler);

// 404 handler - must be registered last
app.use(notFound);

export default app;
