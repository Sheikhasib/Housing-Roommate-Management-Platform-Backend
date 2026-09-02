import z from "zod";

const CreateViewingRequestZodSchema = z.object({
	roomId: z.string().min(1, "roomId is required"),
	preferredDate: z
		.string("Not a string.")
		.datetime({ offset: true, message: "preferredDate must be a valid date" }),
	timeSlot: z
		.enum(["MORNING", "AFTERNOON", "EVENING"], "Invalid time slot.")
		.optional(),
	message: z
		.string("Not a string.")
		.max(500, "Message must be at most 500 characters")
		.optional(),
});

const UpdateViewingStatusZodSchema = z
	.object({
		status: z.enum(
			["APPROVED", "REJECTED", "COMPLETED"],
			"Status must be APPROVED, REJECTED or COMPLETED",
		),
		scheduledDateTime: z
			.string("Not a string.")
			.datetime({
				offset: true,
				message: "scheduledDateTime must be a valid date",
			})
			.optional(),
		rejectionReason: z.string("Not a string.").optional(),
	})
	.superRefine((data, ctx) => {
		if (data.status === "REJECTED" && !data.rejectionReason) {
			ctx.addIssue({
				code: "custom",
				path: ["rejectionReason"],
				message:
					"Rejection reason is required when rejecting a viewing request",
			});
		}
	});

export const ViewingValidation = {
	CreateViewingRequestZodSchema,
	UpdateViewingStatusZodSchema,
};
