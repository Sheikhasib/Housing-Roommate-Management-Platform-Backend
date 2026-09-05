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

const ResolvePendingSettlementZodSchema = z.object({
	outcome: z.enum(
		["SETTLED", "NOT_SETTLED"],
		"Outcome must be SETTLED or NOT_SETTLED",
	),
	providerTrxId: z.string("Not a string.").optional(),
	note: z.string("Not a string.").optional(),
});

const ReviewTenantVerificationZodSchema = z
	.object({
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
				message: "Rejection reason is required when rejecting a tenant",
			});
		}
	});

export const AdminValidation = {
	UpdateUserStatusZodSchema,
	UpdateUserRoleZodSchema,
	ResolvePendingRefundZodSchema,
	ResolvePendingSettlementZodSchema,
	ReviewTenantVerificationZodSchema,
};
