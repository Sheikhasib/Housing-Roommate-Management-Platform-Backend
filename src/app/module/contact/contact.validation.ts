import z from "zod";

const CreateContactMessageZodSchema = z
	.object({
		name: z
			.string("Name is required")
			.trim()
			.min(2, "Name must be at least 2 characters")
			.max(80, "Name must be at most 80 characters"),
		email: z.email("Please enter a valid email address"),
		subject: z
			.string()
			.trim()
			.min(3, "Subject must be at least 3 characters")
			.max(120, "Subject must be at most 120 characters")
			.optional(),
		message: z
			.string("Message is required")
			.trim()
			.min(10, "Message must be at least 10 characters")
			.max(1000, "Message must be at most 1000 characters"),
	})
	.strict();

export const ContactValidation = {
	CreateContactMessageZodSchema,
};
