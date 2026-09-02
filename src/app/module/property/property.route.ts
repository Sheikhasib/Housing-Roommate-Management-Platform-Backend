import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { PropertyController } from "./property.controller";
import { PropertyValidation } from "./property.validation";

const router = Router();

// Create property - OWNER (verified)
router.post(
	"/",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.CreatePropertyZodSchema),
	PropertyController.createProperty,
);

// Get my properties - OWNER
router.get(
	"/my-properties",
	auth(Role.OWNER),
	PropertyController.getMyProperties,
);

// Get all properties - ADMIN
router.get(
	"/all",
	auth(Role.ADMIN, Role.SUPER_ADMIN),
	PropertyController.getAllProperties,
);

// Public property listing (no auth)
router.get("/public", PropertyController.getPublicProperties);

// Property images - OWNER
router.post(
	"/:propertyId/images",
	auth(Role.OWNER),
	upload.array("images", 10),
	PropertyController.uploadPropertyImages,
);

router.delete(
	"/:propertyId/images",
	auth(Role.OWNER),
	PropertyController.removePropertyImage,
);

// Create unit inside property - OWNER
router.post(
	"/:propertyId/units",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.CreateUnitZodSchema),
	PropertyController.createUnit,
);

// Single property detail (public, owner & admin aware)
router.get("/:propertyId", PropertyController.getPropertyDetail);

// Update property - OWNER
router.patch(
	"/:propertyId",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.UpdatePropertyZodSchema),
	PropertyController.updateProperty,
);

// Delete property - OWNER / ADMIN
router.delete(
	"/:propertyId",
	auth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	PropertyController.deleteProperty,
);

// Unit operations - OWNER
router.patch(
	"/unit/:unitId",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.UpdateUnitZodSchema),
	PropertyController.updateUnit,
);

router.delete("/unit/:unitId", auth(Role.OWNER), PropertyController.deleteUnit);

export const PropertyRoutes = router;
