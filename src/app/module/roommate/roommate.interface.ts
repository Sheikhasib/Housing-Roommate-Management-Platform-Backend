export interface ISendRoommateRequestPayload {
	receiverTenantProfileId: string;
	message?: string;
}

export interface IRespondRoommateRequestPayload {
	status: "ACCEPTED" | "DECLINED";
}

export interface IInviteMembershipPayload {
	leaseId: string;
	tenantEmail: string;
	message?: string;
}

export interface IRespondMembershipPayload {
	action: "ACCEPT" | "DECLINE";
}

export interface IRemoveMembershipPayload {
	reason?: string;
}
