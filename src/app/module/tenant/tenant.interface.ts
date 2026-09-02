export interface IUpdateTenantProfilePayload {
	contactNumber?: string;
	gender?: "MALE" | "FEMALE" | "OTHER";
	dateOfBirth?: string; // ISO date
	occupation?: string;
	bio?: string;
	preferredCity?: string;
	monthlyBudgetMax?: number;
	moveInDate?: string; // ISO date
	smoker?: boolean;
	petFriendly?: boolean;
	hasPets?: boolean;
	lookingForRoommate?: boolean;
}
