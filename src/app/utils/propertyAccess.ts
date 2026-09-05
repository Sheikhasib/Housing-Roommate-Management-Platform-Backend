import { Role } from "../../generated/prisma/enums";
import type { RequestUser } from "../middleware/checkAuth";
import { prisma } from "../lib/prisma";

// Property-level capability layer (spec 17). Managers are members, not owners:
// authorization is membership-based (a PropertyManager join row), never
// Property.ownerId. OPERATE tier = owner or assigned manager; CONTROL tier =
// owner only (enforced by route role sets + the verified-owner guard —
// managers simply cannot reach those routes).

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

	// OWNER requires the OWNER role AND ownership: a demoted ex-owner (whose
	// profile and properties survive a role change) must not keep owner powers.
	if (user.role === Role.OWNER && property.owner.userId === user.userId) {
		return "OWNER";
	}

	if (property.managers.length > 0) return "MANAGER";
	return null;
};

// Prisma `where` fragment for list endpoints scoped to a manager's assigned
// properties (owner-scoped lists keep their ownerId filter).
export const propertyManagerScope = (userId: string) => ({
	managers: { some: { manager: { userId, isDeleted: false } } },
});
