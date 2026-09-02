import type { NotificationType } from "../../generated/prisma/enums";
import { prisma } from "../lib/prisma";

type TNotificationData = {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	data?: unknown;
};

// Helper used across modules to create an in-app notification for a user.
export const createNotification = async ({
	userId,
	type,
	title,
	message,
	data,
}: TNotificationData) => {
	return prisma.notification.create({
		data: {
			userId,
			type,
			title,
			message,
			data: data as any, // Prisma Json field accepts plain objects/arrays
		},
	});
};
