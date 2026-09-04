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

// Manager analytics (non-monetary, assigned properties only)
router.get(
	"/manager-analytics",
	auth(Role.PROPERTY_MANAGER),
	AnalyticsController.getManagerAnalytics,
);

export const AnalyticsRoutes = router;
