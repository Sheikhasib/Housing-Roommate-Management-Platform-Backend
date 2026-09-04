import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { LeaseController } from "./lease.controller";
import { LeaseValidation } from "./lease.validation";

const router = Router();

// My leases - TENANT
router.get("/my-leases", auth(Role.TENANT), LeaseController.getMyLeases);

// Leases on my rooms - OWNER / assigned MANAGER (view-only)
router.get(
	"/owner-leases",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	LeaseController.getOwnerLeases,
);

// Single lease detail (tenant/owner/assigned manager (view-only)/admin)
router.get(
	"/:leaseId",
	auth(
		Role.TENANT,
		Role.OWNER,
		Role.PROPERTY_MANAGER,
		Role.ADMIN,
		Role.SUPER_ADMIN,
	),
	LeaseController.getLeaseDetail,
);

// Terminate a lease (tenant/owner/admin)
router.post(
	"/:leaseId/terminate",
	auth(Role.TENANT, Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	validateRequest(LeaseValidation.TerminateLeaseZodSchema),
	LeaseController.terminateLease,
);

// Upload a rental document to a lease
router.post(
	"/:leaseId/documents",
	auth(Role.TENANT, Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	upload.single("document"),
	LeaseController.uploadLeaseDocument,
);

// Remove a lease document (owner/admin)
router.delete(
	"/:leaseId/documents/:documentId",
	auth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	LeaseController.removeLeaseDocument,
);

export const LeaseRoutes = router;
