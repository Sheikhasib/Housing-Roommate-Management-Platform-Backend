import z from "zod";

const RoomTypeEnum = z.enum(
	["PRIVATE_ROOM", "SHARED_ROOM", "ENTIRE_FLAT", "BED"],
	"Invalid room type.",
);

const RoomStatusEnum = z.enum(
	["AVAILABLE", "RESERVED", "OCCUPIED", "MAINTENANCE"],
	"Invalid room status.",
);

const CreateRoomZodSchema = z.object({
	propertyId: z.string().min(1, "propertyId is required"),
	unitId: z.string().optional(),
	name: z
		.string("Not a string.")
		.min(1, "Room name is required")
		.max(50, "Room name must be at most 50 characters"),
	description: z.string("Not a string.").optional(),
	type: RoomTypeEnum.optional(),
	bedCount: z
		.number("bedCount must be a number.")
		.int("bedCount must be an integer.")
		.min(1, "A room must have at least one bed")
		.max(8, "A room can have at most 8 beds")
		.optional(),
	monthlyRent: z
		.number("monthlyRent must be a number.")
		.positive("monthlyRent must be positive"),
	bookingDeposit: z
		.number("bookingDeposit must be a number.")
		.nonnegative("bookingDeposit cannot be negative")
		.optional(),
	minLeaseMonths: z
		.number("minLeaseMonths must be a number.")
		.int()
		.min(1, "minLeaseMonths must be at least 1")
		.max(60, "minLeaseMonths cannot exceed 60")
		.optional(),
	sizeSqft: z
		.number("sizeSqft must be a number.")
		.int()
		.positive("sizeSqft must be positive")
		.optional(),
	isFurnished: z.boolean().optional(),
	amenities: z
		.array(z.string(), "amenities must be an array of strings")
		.optional(),
	availableFrom: z
		.string("Not a string.")
		.datetime({ offset: true, message: "availableFrom must be a valid date" })
		.optional(),
});

const UpdateRoomZodSchema = z
	.object({
		name: z
			.string("Not a string.")
			.min(1, "Room name is required")
			.max(50, "Room name must be at most 50 characters")
			.optional(),
		description: z.string("Not a string.").optional(),
		type: RoomTypeEnum.optional(),
		bedCount: z.number("bedCount must be a number.").int().min(1).optional(),
		monthlyRent: z
			.number("monthlyRent must be a number.")
			.positive("monthlyRent must be positive")
			.optional(),
		bookingDeposit: z
			.number("bookingDeposit must be a number.")
			.nonnegative("bookingDeposit cannot be negative")
			.optional(),
		minLeaseMonths: z
			.number("minLeaseMonths must be a number.")
			.int()
			.min(1)
			.optional(),
		sizeSqft: z
			.number("sizeSqft must be a number.")
			.int()
			.positive()
			.optional(),
		isFurnished: z.boolean().optional(),
		amenities: z
			.array(z.string(), "amenities must be an array of strings")
			.optional(),
	})
	.strict();

const SetRoomAvailabilityZodSchema = z
	.object({
		status: RoomStatusEnum.optional(),
		isPublished: z.boolean().optional(),
		availableFrom: z
			.string("Not a string.")
			.datetime({ offset: true, message: "availableFrom must be a valid date" })
			.optional(),
	})
	.strict();

export const RoomValidation = {
	CreateRoomZodSchema,
	UpdateRoomZodSchema,
	SetRoomAvailabilityZodSchema,
};
