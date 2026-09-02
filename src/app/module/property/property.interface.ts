import type { PropertyType } from "../../../generated/prisma/enums";

export interface ICreatePropertyPayload {
	title: string;
	description?: string;
	type?: PropertyType;
	city: string;
	area?: string;
	address?: string;
	googleMapUrl?: string;
	amenities?: string[];
	houseRules?: string;
}

export interface IUpdatePropertyPayload {
	title?: string;
	description?: string;
	type?: PropertyType;
	city?: string;
	area?: string;
	address?: string;
	googleMapUrl?: string;
	amenities?: string[];
	houseRules?: string;
}

export interface ICreateUnitPayload {
	label: string;
	description?: string;
	floor?: number;
}

export interface IUpdateUnitPayload {
	label?: string;
	description?: string;
	floor?: number;
}
