import { prisma } from "../lib/prisma";

type TAuditLogData = {
	action: string;
	entity: string;
	entityId?: string | null;
	actorId?: string | null;
	actorEmail?: string | null;
	actorRole?: string | null;
	before?: unknown;
	after?: unknown;
	ipAddress?: string | null;
	userAgent?: string | null;
};

// Append-only audit trail for critical actions (status changes, role changes,
// approvals, refunds, etc).
export const writeAuditLog = async ({
	action,
	entity,
	entityId,
	actorId,
	actorEmail,
	actorRole,
	before,
	after,
	ipAddress,
	userAgent,
}: TAuditLogData) => {
	return prisma.auditLog.create({
		data: {
			action,
			entity,
			entityId,
			actorId,
			actorEmail,
			actorRole,
			before: before as any, // Prisma Json field
			after: after as any, // Prisma Json field
			ipAddress,
			userAgent,
		},
	});
};
