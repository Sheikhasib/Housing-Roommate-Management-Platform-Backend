import type { AuthProvider, Role } from "../../../generated/prisma/enums";

export interface IRequestUser {
	userId: string;
	email: string;
	name: string;
	role: Role;
}

export interface IRegisterPayload {
	name: string;
	email: string;
	password: string;
	role: Role;
	profile?: {
		contactNumber?: string;
		gender?: "MALE" | "FEMALE" | "OTHER";
		occupation?: string;
		preferredCity?: string;
		monthlyBudgetMax?: number;
		smoker?: boolean;
		petFriendly?: boolean;
		lookingForRoommate?: boolean;
		companyName?: string;
		address?: string;
		bio?: string;
	};
}

export interface IVerifyEmailPayload {
	email: string;
	otp: string;
}

export interface ILoginPayload {
	email: string;
	password: string;
}

export interface IGoogleLoginPayload {
	idToken: string;
}

export interface IForgotPasswordPayload {
	email: string;
}

export interface IResetPasswordPayload {
	email: string;
	newPassword: string;
	otp: string;
}

export interface IRequestTokenUser extends IRequestUser {
	authProvider?: AuthProvider;
}
