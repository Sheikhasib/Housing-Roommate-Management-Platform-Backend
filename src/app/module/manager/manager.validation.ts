import z from "zod";

const UpdateManagerProfileZodSchema = z
	.object({
		contactNumber: z.string("Not a string.").optional(),
		bio: z
			.string("Not a string.")
			.max(500, "Bio must be at most 500 characters long")
			.optional(),
	})
	.strict();

export const ManagerValidation = {
	UpdateManagerProfileZodSchema,
};
