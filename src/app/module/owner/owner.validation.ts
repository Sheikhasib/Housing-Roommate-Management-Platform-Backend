import z from "zod";

const VerifyOwnerZodSchema = z
	.object({
		ownerProfileId: z.string().min(1, "ownerProfileId is required"),
		verificationStatus: z.enum(
			["APPROVED", "REJECTED"],
			"verificationStatus must be APPROVED or REJECTED",
		),
		rejectionReason: z.string("Not a string.").optional(),
	})
	.superRefine((data, ctx) => {
		if (data.verificationStatus === "REJECTED" && !data.rejectionReason) {
			ctx.addIssue({
				code: "custom",
				path: ["rejectionReason"],
				message: "Rejection reason is required when rejecting an owner",
			});
		}
	});

const UpdateOwnerProfileZodSchema = z
	.object({
		contactNumber: z
			.string("Not a string.")
			.min(8, "Contact number must be at least 8 characters long")
			.optional(),
		companyName: z
			.string("Not a string.")
			.min(2, "Company name must be at least 2 characters long")
			.optional(),
		address: z.string("Not a string.").optional(),
	})
	.strict();

export const OwnerValidation = {
	VerifyOwnerZodSchema,
	UpdateOwnerProfileZodSchema,
};
