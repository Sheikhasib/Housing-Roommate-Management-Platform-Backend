import z from "zod";

const PropertyTypeEnum = z.enum(
	["APARTMENT", "HOSTEL", "DORMITORY", "VILLA", "SHARED_HOUSE", "OTHER"],
	"Invalid property type.",
);

const CreatePropertyZodSchema = z.object({
	title: z
		.string("Not a string.")
		.min(3, "Title must be at least 3 characters long")
		.max(100, "Title must be at most 100 characters long"),
	description: z
		.string("Not a string.")
		.max(2000, "Description must be at most 2000 characters long")
		.optional(),
	type: PropertyTypeEnum.optional(),
	city: z.string("Not a string.").min(2, "City is required"),
	area: z.string("Not a string.").optional(),
	address: z.string("Not a string.").optional(),
	googleMapUrl: z
		.string("Not a string.")
		.url("googleMapUrl must be a valid URL")
		.optional()
		.or(z.literal("")),
	latitude: z
		.number("Latitude must be a number.")
		.min(-90, "Latitude must be between -90 and 90")
		.max(90, "Latitude must be between -90 and 90")
		.optional(),
	longitude: z
		.number("Longitude must be a number.")
		.min(-180, "Longitude must be between -180 and 180")
		.max(180, "Longitude must be between -180 and 180")
		.optional(),
	amenities: z
		.array(z.string(), "amenities must be an array of strings")
		.optional(),
	houseRules: z.string("Not a string.").optional(),
});

const UpdatePropertyZodSchema = z
	.object({
		title: z.string("Not a string.").min(3, "Title too short").optional(),
		description: z
			.string("Not a string.")
			.max(2000, "Description too long")
			.optional(),
		type: PropertyTypeEnum.optional(),
		city: z.string("Not a string.").min(2, "City is required").optional(),
		area: z.string("Not a string.").optional(),
		address: z.string("Not a string.").optional(),
		googleMapUrl: z.string("Not a string.").optional().or(z.literal("")),
		latitude: z
			.number("Latitude must be a number.")
			.min(-90, "Latitude must be between -90 and 90")
			.max(90, "Latitude must be between -90 and 90")
			.optional(),
		longitude: z
			.number("Longitude must be a number.")
			.min(-180, "Longitude must be between -180 and 180")
			.max(180, "Longitude must be between -180 and 180")
			.optional(),
		amenities: z
			.array(z.string(), "amenities must be an array of strings")
			.optional(),
		houseRules: z.string("Not a string.").optional(),
	})
	.strict();

const CreateUnitZodSchema = z.object({
	label: z
		.string("Not a string.")
		.min(1, "Unit label is required")
		.max(50, "Unit label must be at most 50 characters"),
	description: z.string("Not a string.").optional(),
	floor: z
		.number("Floor must be a number.")
		.int()
		.min(-2, "Floor must be -2 or above")
		.max(200, "Floor seems too high")
		.optional(),
});

const UpdateUnitZodSchema = z
	.object({
		label: z
			.string("Not a string.")
			.min(1, "Unit label is required")
			.optional(),
		description: z.string("Not a string.").optional(),
		floor: z.number("Floor must be a number.").int().optional(),
	})
	.strict();

const AssignManagerZodSchema = z.object({
	managerEmail: z.email("managerEmail must be a valid email"),
});

export const PropertyValidation = {
	CreatePropertyZodSchema,
	UpdatePropertyZodSchema,
	CreateUnitZodSchema,
	UpdateUnitZodSchema,
	AssignManagerZodSchema,
};
