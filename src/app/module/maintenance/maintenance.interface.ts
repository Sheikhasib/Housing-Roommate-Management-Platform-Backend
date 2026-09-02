import type {
	MaintenanceCategory,
	MaintenancePriority,
	MaintenanceStatus,
} from "../../../generated/prisma/enums";

export interface ICreateMaintenanceRequestPayload {
	roomId: string;
	category?: MaintenanceCategory;
	priority?: MaintenancePriority;
	title: string;
	description?: string;
}

export interface IUpdateMaintenanceStatusPayload {
	status: MaintenanceStatus;
	assignedTo?: string;
	resolutionNotes?: string;
}
