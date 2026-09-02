import z from "zod";

const passwordSchema = z
	.string()
	.min(4, "Password must be at least 4 characters long")
	.max(32, "Password must be at most 32 characters long")
	.regex(/[A-Z]/, {
		message: "Password must contain at least one uppercase letter",
	})
	.regex(/[a-z]/, {
		message: "Password must contain at least one lowercase letter",
	})
	.regex(/[0-9]/, { message: "Password must contain at least one digit" })
	.regex(/[^A-Za-z0-9]/, {
		message: "Password must contain at least one special character",
	});

const tenantProfileSchema = z
	.object({
		contactNumber: z.string("Not a string.").optional(),
		gender: z.enum(["MALE", "FEMALE", "OTHER"], "Invalid gender.").optional(),
		occupation: z.string("Not a string.").optional(),
		preferredCity: z.string("Not a string.").optional(),
		monthlyBudgetMax: z
			.number("Budget must be a number.")
			.int()
			.positive()
			.optional(),
		smoker: z.boolean().optional(),
		petFriendly: z.boolean().optional(),
		lookingForRoommate: z.boolean().optional(),
	})
	.optional();

const ownerProfileSchema = z
	.object({
		contactNumber: z.string("Not a string.").optional(),
		companyName: z.string("Not a string.").optional(),
		address: z.string("Not a string.").optional(),
	})
	.optional();

// Common fields for both tenant & owner registration
const registerZodSchema = z
	.object({
		name: z
			.string("Not a string.")
			.min(3, "Name must be at least 3 characters long")
			.max(30, "Name must be at most 30 characters long"),
		email: z.email("Not a valid email address."),
		password: passwordSchema,
		role: z
			.enum(["TENANT", "OWNER"], "Role must be TENANT or OWNER.")
			.default("TENANT"),
		profile: z.unknown().optional(),
	})
	.superRefine((data, ctx) => {
		// validate `profile` depending on the chosen role
		if (data.role === "TENANT") {
			const result = tenantProfileSchema.safeParse(data.profile);
			if (!result.success) {
				result.error.issues.forEach((issue) => {
					ctx.addIssue({
						code: "custom",
						path: issue.path,
						message: issue.message,
					});
				});
			}
		}

		if (data.role === "OWNER") {
			const result = ownerProfileSchema.safeParse(data.profile);
			if (!result.success) {
				result.error.issues.forEach((issue) => {
					ctx.addIssue({
						code: "custom",
						path: issue.path,
						message: issue.message,
					});
				});
			}
		}
	});

const verifyEmailZodSchema = z.object({
	email: z.email("Not a valid email address."),
	otp: z.string().length(6, "OTP must be exactly 6 characters"),
});

const LoginZodSchema = z.object({
	email: z.email("Not a valid email address."),
	password: passwordSchema,
});

const ForgotPasswordZodSchema = z.object({
	email: z.email("Not a valid email address."),
});

const ResetPasswordZodSchema = z.object({
	email: z.email("Not a valid email address."),
	newPassword: passwordSchema,
	otp: z.string().length(6, "OTP must be exactly 6 characters"),
});

const GoogleLoginZodSchema = z.object({
	idToken: z.string().min(1, "Google id token is required"),
});

export const AuthValidation = {
	registerZodSchema,
	verifyEmailZodSchema,
	LoginZodSchema,
	ForgotPasswordZodSchema,
	ResetPasswordZodSchema,
	GoogleLoginZodSchema,
};
