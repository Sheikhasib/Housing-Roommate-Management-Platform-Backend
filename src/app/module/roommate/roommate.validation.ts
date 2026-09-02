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

export const RoommateValidation = {
	SendRoommateRequestZodSchema,
	RespondRoommateRequestZodSchema,
};
