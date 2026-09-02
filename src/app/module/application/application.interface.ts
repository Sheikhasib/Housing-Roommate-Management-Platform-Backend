import type { ApplicationStatus } from "../../../generated/prisma/enums";

export interface IApplyForRoomPayload {
	roomId: string;
	moveInDate: string; // ISO date
	leaseMonths: number;
	roommatePairId?: string;
	message?: string;
}

export interface IReviewApplicationPayload {
	status: "APPROVED" | "REJECTED";
	rejectionReason?: string;
}
