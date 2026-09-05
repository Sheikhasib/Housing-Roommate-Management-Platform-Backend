import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { uploadImages } from "../../lib/multer";
import { auth, optionalAuth } from "../../middleware/checkAuth";
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

// Property images - OWNER (verified) or assigned MANAGER
router.post(
	"/:propertyId/images",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	uploadImages.array("images", 10),
	PropertyController.uploadPropertyImages,
);

router.delete(
	"/:propertyId/images",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	PropertyController.removePropertyImage,
);

// Create unit inside property - OWNER
router.post(
	"/:propertyId/units",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.CreateUnitZodSchema),
	PropertyController.createUnit,
);

// Single property detail (public; owners/admins get the full object via
// optionalAuth - guests and tenants always get the public view)
router.get("/:propertyId", optionalAuth, PropertyController.getPropertyDetail);

// Update property - OWNER (verified) or assigned MANAGER
router.patch(
	"/:propertyId",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
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

// Manager delegation (spec 17) - assignment is OWNER-only (CONTROL tier)
router.post(
	"/:propertyId/managers",
	auth(Role.OWNER),
	validateRequest(PropertyValidation.AssignManagerZodSchema),
	PropertyController.assignManager,
);

router.get(
	"/:propertyId/managers",
	auth(Role.OWNER, Role.PROPERTY_MANAGER),
	PropertyController.listManagers,
);

router.delete(
	"/:propertyId/managers/:managerId",
	auth(Role.OWNER),
	PropertyController.removeManager,
);

export const PropertyRoutes = router;
