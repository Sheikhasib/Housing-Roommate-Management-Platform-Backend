import type { VerificationStatus } from "../../../generated/prisma/enums";

export interface IVerifyOwnerPayload {
	ownerProfileId: string;
	verificationStatus: VerificationStatus;
	rejectionReason?: string;
}

export interface IUpdateOwnerProfilePayload {
	contactNumber?: string;
	companyName?: string;
	address?: string;
}
