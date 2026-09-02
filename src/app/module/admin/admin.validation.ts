import z from "zod";

const UpdateUserStatusZodSchema = z.object({
	status: z.enum(["ACTIVE", "BLOCKED"], "Status must be ACTIVE or BLOCKED"),
	reason: z.string("Not a string.").optional(),
});

const UpdateUserRoleZodSchema = z.object({
	role: z.enum(
		["TENANT", "OWNER", "ADMIN"],
		"Role must be TENANT, OWNER or ADMIN",
	),
	reason: z.string("Not a string.").optional(),
});

export const AdminValidation = {
	UpdateUserStatusZodSchema,
	UpdateUserRoleZodSchema,
};
