import z from "zod";

const SendRoommateRequestZodSchema = z.object({
	receiverTenantProfileId: z
		.string()
		.min(1, "receiverTenantProfileId is required"),
	message: z
		.string("Not a string.")
		.max(500, "Message must be at most 500 characters")
		.optional(),
});

const RespondRoommateRequestZodSchema = z.object({
	status: z.enum(
		["ACCEPTED", "DECLINED"],
		"Status must be ACCEPTED or DECLINED",
	),
});

const InviteMembershipZodSchema = z.object({
	leaseId: z.string().min(1, "leaseId is required"),
	tenantEmail: z.email("tenantEmail must be a valid email"),
	message: z
		.string("Not a string.")
		.max(500, "Message must be at most 500 characters")
		.optional(),
});

const RespondMembershipZodSchema = z.object({
	action: z.enum(["ACCEPT", "DECLINE"], "Action must be ACCEPT or DECLINE"),
});

const RemoveMembershipZodSchema = z.object({
	reason: z
		.string("Not a string.")
		.max(300, "Reason must be at most 300 characters")
		.optional(),
});

export const RoommateValidation = {
	SendRoommateRequestZodSchema,
	RespondRoommateRequestZodSchema,
	InviteMembershipZodSchema,
	RespondMembershipZodSchema,
	RemoveMembershipZodSchema,
};
