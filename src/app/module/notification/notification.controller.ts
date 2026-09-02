import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { NotificationServices } from "./notification.service";

// My notifications
const getMyNotifications = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await NotificationServices.getMyNotifications(
		user,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Notifications fetched successfully",
		data,
		meta,
	});
});

// Unread count
const getUnreadNotificationCount = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const result = await NotificationServices.getUnreadNotificationCount(user);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Unread notification count fetched successfully",
			data: result,
		});
	},
);

// Mark one notification read
const markNotificationAsRead = catchAsync(
	async (req: Request, res: Response) => {
		const notificationId = req.params.notificationId as string;
		const user = req.user!;

		const result = await NotificationServices.markNotificationAsRead(
			notificationId,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Notification marked as read",
			data: result,
		});
	},
);

// Mark all read
const markAllNotificationsAsRead = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const result = await NotificationServices.markAllNotificationsAsRead(user);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "All notifications marked as read",
			data: result,
		});
	},
);

export const NotificationController = {
	getMyNotifications,
	getUnreadNotificationCount,
	markNotificationAsRead,
	markAllNotificationsAsRead,
};
