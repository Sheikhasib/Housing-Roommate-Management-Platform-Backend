import type { Role, UserStatus } from "../../../generated/prisma/enums";

export interface IUpdateUserStatusPayload {
	status: UserStatus;
	reason?: string;
}

export interface IUpdateUserRolePayload {
	role: Role;
	reason?: string;
}

export interface IResolvePendingRefundPayload {
	outcome: "REFUNDED" | "NOT_REFUNDED";
	refundTrxId?: string;
	note?: string;
}

export interface IReviewTenantVerificationPayload {
	verificationStatus: "APPROVED" | "REJECTED";
	rejectionReason?: string;
}
