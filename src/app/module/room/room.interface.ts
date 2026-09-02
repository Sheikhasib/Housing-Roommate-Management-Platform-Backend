import type { RoomStatus, RoomType } from "../../../generated/prisma/enums";

export interface ICreateRoomPayload {
	propertyId: string;
	unitId?: string;
	name: string;
	type?: RoomType;
	bedCount?: number;
	monthlyRent: number;
	bookingDeposit?: number;
	minLeaseMonths?: number;
	sizeSqft?: number;
	isFurnished?: boolean;
	amenities?: string[];
	availableFrom?: string; // ISO date
	description?: string;
}

export interface IUpdateRoomPayload {
	name?: string;
	type?: RoomType;
	bedCount?: number;
	monthlyRent?: number;
	bookingDeposit?: number;
	minLeaseMonths?: number;
	sizeSqft?: number;
	isFurnished?: boolean;
	amenities?: string[];
	description?: string;
}

export interface ISetRoomAvailabilityPayload {
	status?: RoomStatus;
	isPublished?: boolean;
	availableFrom?: string; // ISO date
}
