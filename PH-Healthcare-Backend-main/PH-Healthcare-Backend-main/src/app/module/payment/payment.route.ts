import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { PaymentController } from "./payment.controller";

const router = Router();

// Get my payments(Patient)
router.get("/my-payments", auth(Role.PATIENT), PaymentController.getMyPayments);

// Get all payments(Admin)
router.get(
  "/all-payments",
  auth(Role.ADMIN, Role.SUPER_ADMIN),
  PaymentController.getAllPayments,
);

// Get Single Payment by Id (Patient or Admin or Super Admin)
router.get(
  "/:paymentId",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  PaymentController.getSinglePayment,
);

export const PaymentRoutes = router;
