import {
	ApplicationStatus,
	InvoiceStatus,
	InvoiceType,
	LeaseStatus,
	MaintenanceStatus,
	NotificationType,
	PaymentStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";

// TENANT analytics
const getTenantAnalytics = async (user: RequestUser) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const totalApplications = await prisma.application.count({
		where: { tenantProfileId: tenantProfile.id, isDeleted: false },
	});
	const approvedApplications = await prisma.application.count({
		where: {
			tenantProfileId: tenantProfile.id,
			status: ApplicationStatus.APPROVED,
			isDeleted: false,
		},
	});
	const rejectedApplications = await prisma.application.count({
		where: {
			tenantProfileId: tenantProfile.id,
			status: ApplicationStatus.REJECTED,
			isDeleted: false,
		},
	});

	const activeLeases = await prisma.lease.count({
		where: {
			tenantProfileId: tenantProfile.id,
			status: LeaseStatus.ACTIVE,
			isDeleted: false,
		},
	});
	const completedLeases = await prisma.lease.count({
		where: {
			tenantProfileId: tenantProfile.id,
			status: { in: [LeaseStatus.COMPLETED, LeaseStatus.TERMINATED] },
			isDeleted: false,
		},
	});

	// money spent
	const spentResult = await prisma.payment.aggregate({
		where: {
			status: PaymentStatus.PAID,
			OR: [
				{ application: { tenantProfileId: tenantProfile.id } },
				{ invoice: { lease: { tenantProfileId: tenantProfile.id } } },
			],
		},
		_sum: { amount: true },
	});

	// outstanding invoices
	const outstandingInvoices = await prisma.invoice.count({
		where: {
			lease: { tenantProfileId: tenantProfile.id },
			status: InvoiceStatus.UNPAID,
			isDeleted: false,
		},
	});

	const totalDue = await prisma.invoice.aggregate({
		where: {
			lease: { tenantProfileId: tenantProfile.id },
			status: InvoiceStatus.UNPAID,
			isDeleted: false,
		},
		_sum: { amount: true },
	});

	const openMaintenance = await prisma.maintenanceRequest.count({
		where: {
			tenantProfileId: tenantProfile.id,
			status: { notIn: [MaintenanceStatus.RESOLVED, MaintenanceStatus.CLOSED] },
			isDeleted: false,
		},
	});

	const roommateCount = await prisma.roommatePair.count({
		where: {
			OR: [{ tenantAId: tenantProfile.id }, { tenantBId: tenantProfile.id }],
		},
	});

	return {
		totalApplications,
		approvedApplications,
		rejectedApplications,
		activeLeases,
		completedLeases,
		totalSpent: spentResult._sum.amount?.toNumber() || 0,
		outstandingInvoices,
		totalDue: totalDue._sum.amount?.toNumber() || 0,
		openMaintenance,
		roommateCount,
	};
};

// OWNER analytics
const getOwnerAnalytics = async (user: RequestUser) => {
	const ownerProfile = await prisma.ownerProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const totalProperties = await prisma.property.count({
		where: { ownerId: ownerProfile.id, isDeleted: false },
	});
	const totalRooms = await prisma.room.count({
		where: { property: { ownerId: ownerProfile.id }, isDeleted: false },
	});
	const publishedRooms = await prisma.room.count({
		where: {
			property: { ownerId: ownerProfile.id },
			isDeleted: false,
			isPublished: true,
		},
	});

	// occupancy on my rooms
	const agg = await prisma.room.aggregate({
		where: { property: { ownerId: ownerProfile.id }, isDeleted: false },
		_sum: { bedCount: true, occupiedBeds: true },
	});
	const totalBeds = agg._sum.bedCount || 0;
	const occupiedBeds = agg._sum.occupiedBeds || 0;

	const activeLeases = await prisma.lease.count({
		where: {
			room: { property: { ownerId: ownerProfile.id } },
			status: LeaseStatus.ACTIVE,
			isDeleted: false,
		},
	});
	const pendingApplications = await prisma.application.count({
		where: {
			room: { property: { ownerId: ownerProfile.id } },
			status: ApplicationStatus.PENDING,
			isDeleted: false,
		},
	});

	// earnings from deposits + invoices on my rooms
	// refunded deposits are moved to REFUNDED (or parked in REFUND_PENDING
	// while a refund is in flight) - neither is PAID, so PAID sums already
	// net them out - never subtract REFUNDED again.
	const earnedResult = await prisma.payment.aggregate({
		where: {
			status: PaymentStatus.PAID,
			OR: [
				{ application: { room: { property: { ownerId: ownerProfile.id } } } },
				{ invoice: { room: { property: { ownerId: ownerProfile.id } } } },
			],
		},
		_sum: { amount: true },
	});

	// outstanding rent invoices on my rooms
	const unpaidInvoiceAgg = await prisma.invoice.aggregate({
		where: {
			room: { property: { ownerId: ownerProfile.id } },
			type: InvoiceType.RENT,
			status: InvoiceStatus.UNPAID,
			isDeleted: false,
		},
		_sum: { amount: true },
	});

	const openMaintenance = await prisma.maintenanceRequest.count({
		where: {
			room: { property: { ownerId: ownerProfile.id } },
			status: { notIn: [MaintenanceStatus.RESOLVED, MaintenanceStatus.CLOSED] },
			isDeleted: false,
		},
	});

	const pendingViewings = await prisma.viewingRequest.count({
		where: {
			room: { property: { ownerId: ownerProfile.id } },
			status: "PENDING",
			isDeleted: false,
		},
	});

	return {
		totalProperties,
		totalRooms,
		publishedRooms,
		totalBeds,
		occupiedBeds,
		occupancyRate: totalBeds ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
		activeLeases,
		pendingApplications,
		pendingViewings,
		openMaintenance,
		totalEarnings: earnedResult._sum.amount?.toNumber() || 0,
		outstandingRent: unpaidInvoiceAgg._sum.amount?.toNumber() || 0,
	};
};

export const AnalyticsServices = {
	getTenantAnalytics,
	getOwnerAnalytics,
};
