import z from "zod";

const UpdateUserStatusZodSchema = z.object({
	status: z.enum(["ACTIVE", "BLOCKED"], "Status must be ACTIVE or BLOCKED"),
	reason: z.string("Not a string.").optional(),
});

const UpdateUserRoleZodSchema = z.object({
	role: z.enum(
		["TENANT", "OWNER", "PROPERTY_MANAGER", "ADMIN"],
		"Role must be TENANT, OWNER, PROPERTY_MANAGER or ADMIN",
	),
	reason: z.string("Not a string.").optional(),
});

const ResolvePendingRefundZodSchema = z.object({
	outcome: z.enum(
		["REFUNDED", "NOT_REFUNDED"],
		"Outcome must be REFUNDED or NOT_REFUNDED",
	),
	refundTrxId: z.string("Not a string.").optional(),
	note: z.string("Not a string.").optional(),
});

export const AdminValidation = {
	UpdateUserStatusZodSchema,
	UpdateUserRoleZodSchema,
	ResolvePendingRefundZodSchema,
};
