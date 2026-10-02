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

export interface IRoomAvailability {
	vacantBeds: number;
	availableNow: boolean;
	nextAvailableDate: string | null;
	upcomingReleaseDates: string[];
}

export interface IRoomAvailabilitySummary {
	totalRooms: number;
	totalBeds: number;
	occupiedBeds: number;
	vacantBeds: number;
	occupancyRate: number;
	fullyVacantRooms: number;
	partiallyOccupiedRooms: number;
	fullRooms: number;
	maintenanceRooms: number;
	nextAvailableDate: string | null;
}

export interface IRoomAvailabilityRoom extends IRoomAvailability {
	id: string;
	name: string;
	status: RoomStatus;
	isPublished: boolean;
	bedCount: number;
	occupiedBeds: number;
}

export interface IPropertyAvailabilityResponse {
	property: { id: string; title: string; city: string };
	summary: IRoomAvailabilitySummary;
	rooms: IRoomAvailabilityRoom[];
}
