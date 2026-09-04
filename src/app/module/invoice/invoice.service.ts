import httpStatus from "http-status";
import {
	InvoiceStatus,
	InvoiceType,
	LeaseStatus,
	NotificationType,
	PaymentPurpose,
	PaymentStatus,
	Role,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { InvoiceWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { createBkashPayment } from "../../lib/bKash";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { createNotification } from "../../utils/notification";
import { propertyManagerScope } from "../../utils/propertyAccess";
import { sendTemplateEmail } from "../../utils/email";
import type { ICreateUtilityBillPayload } from "./invoice.interface";

// A payment in one of these states blocks opening a new bKash session for
// the same invoice (PROCESSING = session in flight; PAID/REFUND_PENDING/
// REFUNDED = money already moved). FAILED/CANCELLED sessions may be retried.
const sessionBlockingPaymentStatuses: PaymentStatus[] = [
	PaymentStatus.PROCESSING,
	PaymentStatus.PAID,
	PaymentStatus.REFUND_PENDING,
	PaymentStatus.REFUNDED,
];

// TENANT: invoices belonging to my leases
const getMyInvoices = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: InvoiceWhereInput[] = [
		{ isDeleted: false, lease: { tenantProfileId: tenantProfile.id } },
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.type) {
		andConditions.push({ type: query.type });
	}

	const invoices = await prisma.invoice.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { periodStart: "desc" },
		include: {
			lease: {
				select: { id: true, monthlyRent: true },
			},
			room: {
				include: {
					property: { select: { id: true, title: true, city: true } },
				},
			},
			payment: true,
		},
	});

	const total = await prisma.invoice.count({
		where: { AND: andConditions },
	});

	return {
		data: invoices,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER / assigned MANAGER: invoices for a room of theirs
const getRoomInvoices = async (
	user: RequestUser,
	roomId: string,
	query: IQuery,
) => {
	if (user.role === Role.PROPERTY_MANAGER) {
		// membership-based scope: generic 404 (no ownership leak)
		const managedRoom = await prisma.room.findFirst({
			where: {
				id: roomId,
				isDeleted: false,
				property: propertyManagerScope(user.userId),
			},
		});

		if (!managedRoom) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}
	} else {
		const ownerProfile = await prisma.ownerProfile.findFirst({
			where: { userId: user.userId, isDeleted: false },
		});

		if (!ownerProfile) {
			throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
		}

		const room = await prisma.room.findFirst({
			where: {
				id: roomId,
				isDeleted: false,
				property: { ownerId: ownerProfile.id },
			},
		});

		if (!room) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: InvoiceWhereInput[] = [{ roomId, isDeleted: false }];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.type) {
		andConditions.push({ type: query.type });
	}

	const invoices = await prisma.invoice.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { periodStart: "desc" },
		include: {
			lease: {
				include: {
					tenantProfile: {
						select: { id: true, name: true, email: true },
					},
				},
			},
			payment: true,
		},
	});

	const total = await prisma.invoice.count({ where: { AND: andConditions } });

	return {
		data: invoices,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// OWNER / assigned MANAGER creates a utility bill for a room; it is split
// equally among every active lease (roommate) currently holding the room.
const createUtilityBill = async (
	payload: ICreateUtilityBillPayload,
	user: RequestUser,
) => {
	// owners bill through their owner profile; managers through membership
	const ownerProfile =
		user.role === Role.PROPERTY_MANAGER
			? null
			: await prisma.ownerProfile.findFirst({
					where: { userId: user.userId, isDeleted: false },
				});

	if (user.role !== Role.PROPERTY_MANAGER && !ownerProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Owner profile not found");
	}

	const transactionResult = await prisma.$transaction(async (tx) => {
		const room = await tx.room.findFirst({
			where: {
				id: payload.roomId,
				isDeleted: false,
				property:
					user.role === Role.PROPERTY_MANAGER
						? propertyManagerScope(user.userId)
						: { ownerId: ownerProfile?.id },
			},
		});

		if (!room) {
			throw new AppError(httpStatus.NOT_FOUND, "Room not found");
		}

		const activeLeases = await tx.lease.findMany({
			where: { roomId: room.id, status: LeaseStatus.ACTIVE, isDeleted: false },
			include: { tenantProfile: true },
		});

		if (activeLeases.length === 0) {
			throw new AppError(
				httpStatus.CONFLICT,
				"Room has no active lease to bill",
			);
		}

		// equally split with 2-decimal precision; the last share keeps the rounding
		const totalInPaisa = Math.round(payload.amount * 100);
		const baseShareInPaisa = Math.floor(totalInPaisa / activeLeases.length);

		const periodStart = new Date(payload.periodStart);
		const periodEnd = new Date(payload.periodEnd);
		const dueDate = new Date(payload.dueDate);

		const createdInvoices: {
			id: string;
			amount: number;
			userId: string;
			tenantEmail: string;
			tenantName: string;
		}[] = [];

		for (let i = 0; i < activeLeases.length; i++) {
			const lease = activeLeases[i];
			const isLast = i === activeLeases.length - 1;

			// last roommate absorbs the rounding difference
			const shareInPaisa = isLast
				? totalInPaisa - baseShareInPaisa * (activeLeases.length - 1)
				: baseShareInPaisa;
			const shareAmount = shareInPaisa / 100;

			const invoice = await tx.invoice.create({
				data: {
					type: InvoiceType.UTILITY,
					amount: shareAmount,
					periodStart,
					periodEnd,
					dueDate,
					description: payload.description || `Utility bill for ${room.name}`,
					leaseId: lease.id,
					roomId: room.id,
				},
			});

			createdInvoices.push({
				id: invoice.id,
				amount: shareAmount,
				userId: lease.tenantProfile.userId,
				tenantEmail: lease.tenantProfile.email,
				tenantName: lease.tenantProfile.name,
			});
		}

		return createdInvoices;
	});

	// notify every affected roommate
	for (const invoice of transactionResult) {
		await createNotification({
			userId: invoice.userId,
			type: NotificationType.INVOICE,
			title: "Utility bill generated 💡",
			message: `A utility bill of ৳${invoice.amount} has been assigned to you.`,
			data: { invoiceId: invoice.id },
		});

		await sendTemplateEmail({
			to: invoice.tenantEmail,
			subject: "New Utility Bill - Housing & Roommate",
			template: "invoice-created",
			data: {
				name: invoice.tenantName,
				amount: invoice.amount,
				description: payload.description || "Utility bill",
			},
		});
	}

	return transactionResult;
};

// TENANT: pay one of my invoices via bKash
const payInvoice = async (invoiceId: string, user: RequestUser) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const invoice = await prisma.invoice.findUnique({
		where: { id: invoiceId },
		include: { lease: true },
	});

	if (!invoice || invoice.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Invoice not found");
	}

	if (invoice.lease.tenantProfileId !== tenantProfile.id) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"You can only pay your own invoices",
		);
	}

	if (invoice.status !== InvoiceStatus.UNPAID) {
		throw new AppError(
			httpStatus.CONFLICT,
			`Invoice is already ${invoice.status.toLowerCase()}`,
		);
	}

	// the invoice itself stays UNPAID while a session is in flight, so an
	// existing live/completed payment must block a second session (otherwise
	// two concurrent sessions could both charge the tenant at the gateway)
	const existingPayment = await prisma.payment.findUnique({
		where: { invoiceId: invoice.id },
	});

	if (
		existingPayment &&
		sessionBlockingPaymentStatuses.includes(existingPayment.status)
	) {
		throw new AppError(
			httpStatus.CONFLICT,
			"A payment for this invoice is already in progress or completed",
		);
	}

	const purpose =
		invoice.type === InvoiceType.RENT
			? PaymentPurpose.RENT
			: PaymentPurpose.UTILITY;

	const bKashCreatePaymentResult = await createBkashPayment({
		amount: invoice.amount.toString(),
		payerReference: user.email,
		merchantInvoiceNumber: invoice.id,
		callbackPath: "/payment/callback",
	});

	const payment = await prisma.payment.upsert({
		where: { invoiceId: invoice.id },
		update: {
			status: PaymentStatus.PROCESSING,
			purpose,
			amount: invoice.amount.toString(),
			merchantInvoiceNumber: invoice.id,
			bKashPaymentId: bKashCreatePaymentResult.paymentID,
			payerReference: user.email,
			gatwayResponse: bKashCreatePaymentResult,
		},
		create: {
			status: PaymentStatus.PROCESSING,
			purpose,
			amount: invoice.amount.toString(),
			merchantInvoiceNumber: invoice.id,
			bKashPaymentId: bKashCreatePaymentResult.paymentID,
			payerReference: user.email,
			gatwayResponse: bKashCreatePaymentResult,
			invoiceId: invoice.id,
		},
	});

	return {
		payment,
		paymentUrl: bKashCreatePaymentResult.bkashURL,
	};
};

export const InvoiceServices = {
	getMyInvoices,
	getRoomInvoices,
	createUtilityBill,
	payInvoice,
};
