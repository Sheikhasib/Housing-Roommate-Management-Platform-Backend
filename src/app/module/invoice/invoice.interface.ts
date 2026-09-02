export interface ICreateUtilityBillPayload {
	roomId: string;
	amount: number;
	periodStart: string; // ISO date
	periodEnd: string; // ISO date
	dueDate: string; // ISO date
	description?: string;
}
