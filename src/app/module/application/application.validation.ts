import z from "zod";

const ApplyForRoomZodSchema = z.object({
	roomId: z.string().min(1, "roomId is required"),
	moveInDate: z
		.string("Not a string.")
		.datetime({ offset: true, message: "moveInDate must be a valid date" }),
	leaseMonths: z
		.number("leaseMonths must be a number.")
		.int("leaseMonths must be an integer.")
		.min(1, "leaseMonths must be at least 1")
		.max(60, "leaseMonths cannot exceed 60"),
	roommatePairId: z.string().optional(),
	message: z
		.string("Not a string.")
		.max(500, "Message must be at most 500 characters")
		.optional(),
});

const ReviewApplicationZodSchema = z
	.object({
		status: z.enum(
			["APPROVED", "REJECTED"],
			"Status must be APPROVED or REJECTED",
		),
		rejectionReason: z.string("Not a string.").optional(),
	})
	.superRefine((data, ctx) => {
		if (data.status === "REJECTED" && !data.rejectionReason) {
			ctx.addIssue({
				code: "custom",
				path: ["rejectionReason"],
				message: "Rejection reason is required when rejecting an application",
			});
		}
	});

export const ApplicationValidation = {
	ApplyForRoomZodSchema,
	ReviewApplicationZodSchema,
};
