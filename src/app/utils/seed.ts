import bcrypt from "bcryptjs";
import httpStatus from "http-status";
import { OwnerVerificationStatus, Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { AppError } from "./AppError";

// A clean helper to build a verified user without repeating the same block.
const createUser = async ({
	name,
	email,
	password,
	role,
}: {
	name: string;
	email: string;
	password: string;
	role: Role;
}) => {
	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	return prisma.user.create({
		data: {
			name,
			email,
			password: hashedPassword,
			role,
			emailVerified: true,
		},
	});
};

export const seedSuperAdmin = async () => {
	const email = config.super_admin_email;

	if (!email || !config.super_admin_password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Super admin credentials missing in .env file!!!",
		);
	}

	const existing = await prisma.user.findUnique({ where: { email } });

	if (existing) {
		console.log("Super Admin Already Exists!");
		return;
	}

	await createUser({
		name: config.super_admin_name,
		email,
		password: config.super_admin_password,
		role: Role.SUPER_ADMIN,
	});

	console.log("Super Admin created.");
};

export const seedTesterAdmin = async () => {
	const email = config.tester_admin_email;

	if (!email || !config.tester_admin_password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Tester admin credentials missing in .env file!!!",
		);
	}

	const existing = await prisma.user.findUnique({ where: { email } });

	if (existing) {
		console.log("Tester Admin Already Exists!");
		return;
	}

	await createUser({
		name: config.tester_admin_name,
		email,
		password: config.tester_admin_password,
		role: Role.ADMIN,
	});

	console.log("Tester Admin created.");
};

// Approved demo owner + a sample published property with rooms so the API can
// be demonstrated immediately after login.
export const seedTesterOwner = async () => {
	const email = config.tester_owner_email;

	if (!email || !config.tester_owner_password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Tester owner credentials missing in .env file!!!",
		);
	}

	let user = await prisma.user.findUnique({
		where: { email },
		include: { ownerProfile: true },
	});

	if (!user) {
		await createUser({
			name: config.tester_owner_name,
			email,
			password: config.tester_owner_password,
			role: Role.OWNER,
		});

		user = await prisma.user.findUnique({
			where: { email },
			include: { ownerProfile: true },
		});
	}

	if (!user) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Failed to create tester owner",
		);
	}

	if (user.ownerProfile) {
		console.log("Tester Owner Already Exists!");
		return;
	}

	const ownerProfile = await prisma.ownerProfile.create({
		data: {
			userId: user.id,
			name: config.tester_owner_name,
			email,
			contactNumber: "+8801711111111",
			companyName: "Green Valley Properties",
			address: "Banani, Dhaka",
			verificationStatus: OwnerVerificationStatus.APPROVED,
			reviewedBy: "system-seed",
			reviewedAt: new Date(),
		},
	});

	// sample property
	const property = await prisma.property.create({
		data: {
			title: "Green View Residence",
			description: "A modern family apartment building close to Banani market.",
			type: "APARTMENT",
			city: "Dhaka",
			area: "Banani",
			address: "House 12, Road 11, Banani",
			amenities: ["wifi", "lift", "parking", "generator", "security"],
			houseRules: "No smoking indoors. Quiet hours after 11 PM.",
			ownerId: ownerProfile.id,
		},
	});

	const unit = await prisma.unit.create({
		data: {
			propertyId: property.id,
			label: "Flat 3B",
			description: "3 bedroom flat on the 3rd floor",
			floor: 3,
		},
	});

	// two rooms: a private room and a shared room for roommate demos
	await prisma.room.create({
		data: {
			propertyId: property.id,
			unitId: unit.id,
			name: "Room 101 (Master)",
			type: "PRIVATE_ROOM",
			bedCount: 1,
			monthlyRent: 18000,
			bookingDeposit: 18000,
			minLeaseMonths: 6,
			sizeSqft: 220,
			isFurnished: true,
			amenities: ["attached bathroom", "balcony", "desk", "air cooler"],
			isPublished: true,
			status: "AVAILABLE",
		},
	});

	await prisma.room.create({
		data: {
			propertyId: property.id,
			unitId: unit.id,
			name: "Room 102 (Shared)",
			type: "SHARED_ROOM",
			bedCount: 2,
			monthlyRent: 12000,
			bookingDeposit: 12000,
			minLeaseMonths: 3,
			sizeSqft: 180,
			isFurnished: true,
			amenities: ["attached bathroom", "wifi", "desk"],
			isPublished: true,
			status: "AVAILABLE",
		},
	});

	console.log("Tester Owner created with sample property & rooms.");
};

// Demo property manager, pre-assigned to the seed owner's property so the
// delegation flows (spec 17) can be demonstrated immediately after login.
export const seedTesterManager = async () => {
	const email = config.tester_manager_email;

	if (!email || !config.tester_manager_password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Tester manager credentials missing in .env file!!!",
		);
	}

	let user = await prisma.user.findUnique({
		where: { email },
		include: { managerProfile: true },
	});

	if (!user) {
		await createUser({
			name: config.tester_manager_name,
			email,
			password: config.tester_manager_password,
			role: Role.PROPERTY_MANAGER,
		});

		user = await prisma.user.findUnique({
			where: { email },
			include: { managerProfile: true },
		});
	}

	if (!user) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Failed to create tester manager",
		);
	}

	if (!user.managerProfile) {
		await prisma.managerProfile.create({
			data: {
				userId: user.id,
				name: config.tester_manager_name,
				email,
				contactNumber: "+8801733333333",
				bio: "On-site property manager handling viewings, applications and maintenance.",
			},
		});
	}

	// assign to the seed owner's first live property (idempotent)
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { email: config.tester_owner_email, isDeleted: false },
		include: {
			properties: {
				where: { isDeleted: false },
				orderBy: { createdAt: "asc" },
				take: 1,
			},
		},
	});

	const seedProperty = ownerProfile?.properties[0];

	if (seedProperty) {
		const managerProfile = await prisma.managerProfile.findUnique({
			where: { userId: user.id },
		});

		if (managerProfile) {
			await prisma.propertyManager.upsert({
				where: {
					unique_manager_per_property: {
						propertyId: seedProperty.id,
						managerId: managerProfile.id,
					},
				},
				create: {
					propertyId: seedProperty.id,
					managerId: managerProfile.id,
				},
				update: {},
			});
		}
	}

	console.log("Tester Manager created (assigned to the seed property).");
};

// Demo tenant with a filled roommate-matching profile.
export const seedTesterTenant = async () => {
	const email = config.tester_tenant_email;

	if (!email || !config.tester_tenant_password) {
		throw new AppError(
			httpStatus.INTERNAL_SERVER_ERROR,
			"Tester tenant credentials missing in .env file!!!",
		);
	}

	const existing = await prisma.user.findUnique({
		where: { email },
		include: { tenantProfile: true },
	});

	if (existing) {
		console.log("Tester Tenant Already Exists!");
		return;
	}

	const user = await createUser({
		name: config.tester_tenant_name,
		email,
		password: config.tester_tenant_password,
		role: Role.TENANT,
	});

	await prisma.tenantProfile.create({
		data: {
			userId: user.id,
			name: config.tester_tenant_name,
			email,
			contactNumber: "+8801722222222",
			occupation: "Software Engineer",
			preferredCity: "Dhaka",
			monthlyBudgetMax: 20000,
			moveInDate: new Date(),
			lookingForRoommate: true,
			smoker: false,
			petFriendly: true,
			gender: "MALE",
			bio: "Looking for a calm, tidy roommate near Banani / Gulshan.",
		},
	});

	console.log("Tester Tenant created.");
};
