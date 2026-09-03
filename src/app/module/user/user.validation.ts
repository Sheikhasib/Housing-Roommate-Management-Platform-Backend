import z from "zod";

const updateProfileZodSchema = z
	.object({
		name: z
			.string("Not a string.")
			.min(3, "Name must be at least 3 characters long")
			.max(30, "Name must be at most 30 characters long")
			.optional(),
	})
	.strict();

export const UserValidation = {
	updateProfileZodSchema,
};
