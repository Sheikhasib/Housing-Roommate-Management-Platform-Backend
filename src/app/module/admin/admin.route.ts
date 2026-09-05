import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { AdminController } from "./admin.controller";
import { AdminValidation } from "./admin.validation";

const router = Router();

// Dashboard stats - ADMIN
router.get(
	"/dashboard-stats",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AdminController.getAdminDashboardStats,
);

// All users - ADMIN
router.get(
	"/users",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AdminController.getAllUsers,
);

// Update user status (block/unblock) - ADMIN
router.patch(
	"/users/:userId/status",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(AdminValidation.UpdateUserStatusZodSchema),
	AdminController.updateUserStatus,
);

// Update user role - SUPER_ADMIN
router.patch(
	"/users/:userId/role",
	auth(Role.SUPER_ADMIN),
	validateRequest(AdminValidation.UpdateUserRoleZodSchema),
	AdminController.updateUserRole,
);

// Audit logs - ADMIN
router.get(
	"/audit-logs",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AdminController.getAuditLogs,
);

// Payments stuck in REFUND_PENDING (unknown bKash refund outcome) - ADMIN
router.get(
	"/payments/pending-refunds",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AdminController.getPendingRefundPayments,
);

// Resolve a pending refund payment after checking the bKash portal - ADMIN
router.post(
	"/payments/pending-refunds/:paymentId/resolve",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(AdminValidation.ResolvePendingRefundZodSchema),
	AdminController.resolvePendingRefundPayment,
);

// Pending tenant identity verifications - ADMIN
router.get(
	"/tenant-verifications",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	AdminController.getPendingTenantVerifications,
);

// Review (approve/reject) a tenant verification - ADMIN
router.patch(
	"/tenant-verifications/:tenantProfileId",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(AdminValidation.ReviewTenantVerificationZodSchema),
	AdminController.reviewTenantVerification,
);

export const AdminRoutes = router;
