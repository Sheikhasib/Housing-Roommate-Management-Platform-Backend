import z from "zod";

const TerminateLeaseZodSchema = z.object({
	reason: z
		.string("Not a string.")
		.min(3, "Reason must be at least 3 characters long")
		.max(300, "Reason must be at most 300 characters"),
});

export const LeaseValidation = {
	TerminateLeaseZodSchema,
};
