import z from "zod";

const CreateMaintenanceRequestZodSchema = z.object({
	roomId: z.string().min(1, "roomId is required"),
	category: z
		.enum(
			[
				"PLUMBING",
				"ELECTRICAL",
				"APPLIANCE",
				"FURNITURE",
				"PAINTING",
				"CLEANING",
				"OTHER",
			],
			"Invalid category.",
		)
		.optional(),
	priority: z
		.enum(["LOW", "MEDIUM", "HIGH", "URGENT"], "Invalid priority.")
		.optional(),
	title: z
		.string("Not a string.")
		.min(3, "Title must be at least 3 characters long")
		.max(100, "Title must be at most 100 characters"),
	description: z
		.string("Not a string.")
		.max(1000, "Description must be at most 1000 characters")
		.optional(),
});

const UpdateMaintenanceStatusZodSchema = z
	.object({
		status: z.enum(
			["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED"],
			"Invalid status.",
		),
		assignedTo: z.string("Not a string.").optional(),
		resolutionNotes: z.string("Not a string.").optional(),
	})
	.strict();

export const MaintenanceValidation = {
	CreateMaintenanceRequestZodSchema,
	UpdateMaintenanceStatusZodSchema,
};
