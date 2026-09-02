import z from "zod";

const genderEnum = z.enum(["MALE", "FEMALE", "OTHER"], "Invalid gender.");

const UpdateTenantProfileZodSchema = z
	.object({
		contactNumber: z.string("Not a string.").optional(),
		gender: genderEnum.optional(),
		dateOfBirth: z
			.string("Not a string.")
			.datetime({ offset: true, message: "dateOfBirth must be a valid date" })
			.optional()
			.or(z.date().optional()),
		occupation: z.string("Not a string.").optional(),
		bio: z
			.string("Not a string.")
			.max(500, "Bio must be at most 500 characters long")
			.optional(),
		preferredCity: z.string("Not a string.").optional(),
		monthlyBudgetMax: z
			.number("Budget must be a number.")
			.int("Budget must be an integer.")
			.positive("Budget must be positive.")
			.max(1000000, "Budget seems unrealistically high.")
			.optional(),
		moveInDate: z
			.string("Not a string.")
			.datetime({ offset: true, message: "moveInDate must be a valid date" })
			.optional()
			.or(z.date().optional()),
		smoker: z.boolean().optional(),
		petFriendly: z.boolean().optional(),
		hasPets: z.boolean().optional(),
		lookingForRoommate: z.boolean().optional(),
	})
	.strict();

export const TenantValidation = {
	UpdateTenantProfileZodSchema,
};
