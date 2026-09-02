import { Router } from "express";
import { Role } from "../../../generated/prisma/enums";
import { auth } from "../../middleware/checkAuth";
import { NotificationController } from "./notification.controller";

const router = Router();

// My notifications - any logged in user
router.get(
	"/my-notifications",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	NotificationController.getMyNotifications,
);

// Unread count - any logged in user
router.get(
	"/unread-count",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	NotificationController.getUnreadNotificationCount,
);

// Mark all as read
router.patch(
	"/read-all",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	NotificationController.markAllNotificationsAsRead,
);

// Mark single notification as read
router.patch(
	"/:notificationId/read",
	auth(Role.SUPER_ADMIN, Role.ADMIN, Role.OWNER, Role.TENANT),
	NotificationController.markNotificationAsRead,
);

export const NotificationRoutes = router;
