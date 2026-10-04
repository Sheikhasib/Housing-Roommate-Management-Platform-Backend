import { Router } from "express";
import { contactRateLimiter } from "../../lib/rateLimiter";
import { validateRequest } from "../../middleware/validateRequest";
import { ContactController } from "./contact.controller";
import { ContactValidation } from "./contact.validation";

const router = Router();

// Public contact form message - no auth, per-IP rate limited
router.post(
	"/",
	contactRateLimiter,
	validateRequest(ContactValidation.CreateContactMessageZodSchema),
	ContactController.createContactMessage,
);

export const ContactRoutes = router;
