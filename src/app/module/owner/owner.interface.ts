import type { OwnerVerificationStatus } from "../../../generated/prisma/enums";

export interface IVerifyOwnerPayload {
	ownerProfileId: string;
	verificationStatus: OwnerVerificationStatus;
	rejectionReason?: string;
}

export interface IUpdateOwnerProfilePayload {
	contactNumber?: string;
	companyName?: string;
	address?: string;
}
