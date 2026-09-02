import type { Role, UserStatus } from "../../../generated/prisma/enums";

export interface IUpdateUserStatusPayload {
	status: UserStatus;
	reason?: string;
}

export interface IUpdateUserRolePayload {
	role: Role;
	reason?: string;
}
