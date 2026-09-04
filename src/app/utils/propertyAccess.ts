import httpStatus from "http-status";
import { Role } from "../../generated/prisma/enums";
import type { RequestUser } from "../middleware/checkAuth";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

// Property-level capability layer (spec 17). Managers are members, not owners:
// authorization is membership-based (a PropertyManager join row), never
// Property.ownerId. OPERATE tier = owner or assigned manager; CONTROL tier =
// owner only (admins override). Both helpers accept a transaction client so
// they can run inside prisma.$transaction.

export type PropertyRole = "OWNER" | "MANAGER";

// Structural slice of the client: the global prisma and a $transaction client
// both satisfy it.
type PropertyAccessDb = Pick<typeof prisma, "property" | "propertyManager">;

export const resolvePropertyRole = async (
	user: RequestUser,
	propertyId: string,
	db?: PropertyAccessDb,
): Promise<PropertyRole | null> => {
	const database = db ?? prisma;

	const property = await database.property.findFirst({
		where: { id: propertyId, isDeleted: false },
		select: {
			owner: { select: { userId: true } },
			managers: {
				where: { manager: { userId: user.userId, isDeleted: false } },
				select: { id: true },
			},
		},
	});

	if (!property) return null;

	if (property.owner.userId === user.userId) return "OWNER";
	if (property.managers.length > 0) return "MANAGER";
	return null;
};

// OPERATE tier: the caller must be the property's owner or an assigned manager.
export const assertPropertyAccess = async (
	user: RequestUser,
	propertyId: string,
	db?: PropertyAccessDb,
): Promise<PropertyRole> => {
	const role = await resolvePropertyRole(user, propertyId, db);

	if (!role) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to manage this property",
		);
	}

	return role;
};

// CONTROL tier: owner only (ADMIN/SUPER_ADMIN override). Used for money,
// destructive and delegation boundaries (lease termination, refunds, property
// create/delete, manager assignment).
export const assertPropertyControl = async (
	user: RequestUser,
	propertyId: string,
	db?: PropertyAccessDb,
): Promise<void> => {
	if (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) return;

	const role = await resolvePropertyRole(user, propertyId, db);

	if (role !== "OWNER") {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You are not allowed to manage this property",
		);
	}
};

// Prisma `where` fragment for list endpoints scoped to a manager's assigned
// properties (owner-scoped lists keep their ownerId filter).
export const propertyManagerScope = (userId: string) => ({
	managers: { some: { manager: { userId, isDeleted: false } } },
});
