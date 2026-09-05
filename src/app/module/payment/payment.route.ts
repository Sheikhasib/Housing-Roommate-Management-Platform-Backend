import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { PaymentController } from "./payment.controller";

const router = Router();

// Enabled gateways - public (powers the frontend payment buttons)
router.get("/gateways", PaymentController.getGateways);

// bKash callback URL - no auth (hit by the gateway)
// Full URL: {BKASH_CALLBACK_URL}/payment/callback
router.get("/callback", PaymentController.paymentCallback);

// My payments - TENANT
router.get("/my-payments", auth(Role.TENANT), PaymentController.getMyPayments);

// All payments - ADMIN
router.get(
	"/all-payments",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.getAllPayments,
);

// Single payment detail
router.get(
	"/:paymentId",
	auth(Role.TENANT, Role.ADMIN, Role.SUPER_ADMIN),
	PaymentController.getSinglePayment,
);

export const PaymentRoutes = router;
