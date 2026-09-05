import httpStatus from "http-status";
import type { IQuery } from "../../interfaces";
import type { NotificationWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";

// List my notifications (newest first)
const getMyNotifications = async (user: RequestUser, query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: NotificationWhereInput[] = [{ userId: user.userId }];

	if (query.isRead !== undefined) {
		andConditions.push({ isRead: query.isRead === "true" });
	}

	const notifications = await prisma.notification.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
	});

	const total = await prisma.notification.count({
		where: { AND: andConditions },
	});

	return {
		data: notifications,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Count unread notifications (for a badge)
const getUnreadNotificationCount = async (user: RequestUser) => {
	const unreadCount = await prisma.notification.count({
		where: { userId: user.userId, isRead: false },
	});

	return { unreadCount };
};

// Mark a single notification as read
const markNotificationAsRead = async (
	notificationId: string,
	user: RequestUser,
) => {
	const notification = await prisma.notification.findFirst({
		where: { id: notificationId, userId: user.userId },
	});

	if (!notification) {
		throw new AppError(httpStatus.NOT_FOUND, "Notification not found");
	}

	// already read: return as-is so a repeated call never rewrites readAt
	if (notification.isRead) {
		return notification;
	}

	return prisma.notification.update({
		where: { id: notificationId },
		data: { isRead: true, readAt: new Date() },
	});
};

// Mark every notification as read
const markAllNotificationsAsRead = async (user: RequestUser) => {
	const result = await prisma.notification.updateMany({
		where: { userId: user.userId, isRead: false },
		data: { isRead: true, readAt: new Date() },
	});

	return { updatedCount: result.count };
};

export const NotificationServices = {
	getMyNotifications,
	getUnreadNotificationCount,
	markNotificationAsRead,
	markAllNotificationsAsRead,
};
