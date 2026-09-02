export interface ISendRoommateRequestPayload {
	receiverTenantProfileId: string;
	message?: string;
}

export interface IRespondRoommateRequestPayload {
	status: "ACCEPTED" | "DECLINED";
}
