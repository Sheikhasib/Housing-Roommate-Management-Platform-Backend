import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { InvoiceController } from "./invoice.controller";
import { InvoiceValidation } from "./invoice.validation";

const router = Router();

// My invoices - TENANT
router.get("/my-invoices", auth(Role.TENANT), InvoiceController.getMyInvoices);

// Create a utility bill for a room - OWNER / assigned MANAGER
router.post(
	"/utility-bill",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	validateRequest(InvoiceValidation.CreateUtilityBillZodSchema),
	InvoiceController.createUtilityBill,
);

// Invoices of a room - OWNER / assigned MANAGER
router.get(
	"/room/:roomId",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	InvoiceController.getRoomInvoices,
);

// Pay an invoice (bKash) - TENANT
router.post("/:invoiceId/pay", auth(Role.TENANT), InvoiceController.payInvoice);

export const InvoiceRoutes = router;
