import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { AnalyticsController } from "./analytics.controller";

const router = Router();

// Tenant analytics
router.get(
	"/tenant-analytics",
	auth(Role.TENANT),
	AnalyticsController.getTenantAnalytics,
);

// Owner analytics
router.get(
	"/owner-analytics",
	auth(Role.OWNER),
	AnalyticsController.getOwnerAnalytics,
);

export const AnalyticsRoutes = router;
