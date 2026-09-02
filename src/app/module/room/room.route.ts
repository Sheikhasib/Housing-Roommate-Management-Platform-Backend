import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { upload } from "../../lib/multer";
import { auth } from "../../middleware/checkAuth";
import { validateRequest } from "../../middleware/validateRequest";
import { RoomController } from "./room.controller";
import { RoomValidation } from "./room.validation";

const router = Router();

// Create room - OWNER
router.post(
	"/",
	auth(Role.OWNER),
	validateRequest(RoomValidation.CreateRoomZodSchema),
	RoomController.createRoom,
);

// Get my rooms - OWNER
router.get("/my-rooms", auth(Role.OWNER), RoomController.getMyRooms);

// Public room search (no auth)
router.get("/public", RoomController.getPublicRooms);

// Single room detail (public/owner/admin aware)
router.get("/:roomId", RoomController.getRoomDetail);

// Update room - OWNER
router.patch(
	"/:roomId",
	auth(Role.OWNER),
	validateRequest(RoomValidation.UpdateRoomZodSchema),
	RoomController.updateRoom,
);

// Set room availability/publish - OWNER
router.patch(
	"/:roomId/availability",
	auth(Role.OWNER),
	validateRequest(RoomValidation.SetRoomAvailabilityZodSchema),
	RoomController.setRoomAvailability,
);

// Delete room - OWNER / ADMIN
router.delete(
	"/:roomId",
	auth(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN),
	RoomController.deleteRoom,
);

// Room images - OWNER
router.post(
	"/:roomId/images",
	auth(Role.OWNER),
	upload.array("images", 10),
	RoomController.uploadRoomImages,
);

router.delete(
	"/:roomId/images",
	auth(Role.OWNER),
	RoomController.removeRoomImage,
);

export const RoomRoutes = router;
