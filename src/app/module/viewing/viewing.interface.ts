import type {
	ViewingStatus,
	ViewingTimeSlot,
} from "../../../generated/prisma/enums";

export interface ICreateViewingRequestPayload {
	roomId: string;
	preferredDate: string; // ISO date
	timeSlot?: ViewingTimeSlot;
	message?: string;
}

export interface IUpdateViewingStatusPayload {
	status: ViewingStatus;
	scheduledDateTime?: string; // ISO datetime
	rejectionReason?: string;
}
