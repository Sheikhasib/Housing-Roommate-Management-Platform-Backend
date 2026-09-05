import httpStatus from "http-status";
import {
	InvoiceStatus,
	InvoiceType,
	LeaseStatus,
	NotificationType,
	PaymentPurpose,
	PaymentStatus,
	Role,
	VerificationStatus,
} from "../../../generated/prisma/enums";
import type { IQuery } from "../../interfaces";
import type { InvoiceWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { getAdapter, parseGateway } from "../../lib/payments/registry";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
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

	// managers may see the billing picture but never the payment ledger
	// (bKash ids, gateway payloads) — spec 17 money isolation
	const data =
		user.role === Role.PROPERTY_MANAGER
			? invoices.map(({ payment, ...invoiceRest }) => invoiceRest)
			: invoices;

	return {
		data,
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

		// billing is always audited, owner or delegated manager alike
		await writeAuditLog(
			{
				action: "UTILITY_BILL_CREATED",
				entity: "Room",
				entityId: room.id,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: null,
				after: {
					amount: payload.amount,
					periodStart: periodStart.toISOString(),
					invoicesCreated: createdInvoices.length,
				},
			},
			tx,
		);

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

// TENANT: pay one of my invoices (any enabled gateway; bKash by default)
const payInvoice = async (
	invoiceId: string,
	user: RequestUser,
	payload: { gateway?: string },
) => {
	const tenantProfile = await prisma.tenantProfile.findFirst({
		where: { userId: user.userId, isDeleted: false },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	// only identity-verified tenants may move money (spec 03/15)
	if (tenantProfile.verificationStatus !== VerificationStatus.APPROVED) {
		throw new AppError(
			httpStatus.FORBIDDEN,
			"Your tenant account is not verified yet. Please complete identity verification before paying",
		);
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

	// gateway resolution happens before any write: an unknown/disabled
	// gateway must never create a session or a payment row
	const gateway = parseGateway(payload?.gateway ?? "bkash");
	const adapter = getAdapter(gateway);

	const purpose =
		invoice.type === InvoiceType.RENT
			? PaymentPurpose.RENT
			: PaymentPurpose.UTILITY;

	// the gateway call happens outside any transaction (no DB locks are held
	// while provider HTTP is in flight)
	const session = await adapter.initiate({
		merchantInvoiceNumber: invoice.id,
		purpose,
		amount: invoice.amount.toString(),
		description: `${invoice.type.toLowerCase()} invoice payment`,
		payerEmail: user.email,
		payerName: tenantProfile.name,
	});

	// create the payment row (or refresh an earlier failed attempt) with the
	// provider-neutral refs + the charge snapshot for the settle-time amount
	// check (I-G2), audited atomically with the upsert
	const payment = await prisma.$transaction(async (tx) => {
		const row = await tx.payment.upsert({
			where: { invoiceId: invoice.id },
			update: {
				status: PaymentStatus.PROCESSING,
				purpose,
				amount: invoice.amount.toString(),
				gateway,
				merchantInvoiceNumber: invoice.id,
				bKashPaymentId: session.providerPaymentId,
				providerChargeCurrency: session.chargeCurrency,
				providerChargeAmount: session.chargeAmountMinorUnits,
				payerReference: user.email,
				gatwayResponse: session.raw as any,
			},
			create: {
				status: PaymentStatus.PROCESSING,
				purpose,
				amount: invoice.amount.toString(),
				gateway,
				merchantInvoiceNumber: invoice.id,
				bKashPaymentId: session.providerPaymentId,
				providerChargeCurrency: session.chargeCurrency,
				providerChargeAmount: session.chargeAmountMinorUnits,
				payerReference: user.email,
				gatwayResponse: session.raw as any,
				invoiceId: invoice.id,
			},
		});

		await writeAuditLog(
			{
				action: "PAYMENT_INITIATED",
				entity: "Payment",
				entityId: row.id,
				actorId: user.userId,
				actorEmail: user.email,
				actorRole: user.role,
				before: existingPayment ? { status: existingPayment.status } : null,
				after: {
					gateway,
					providerPaymentId: session.providerPaymentId,
					amount: invoice.amount.toString(),
					purpose,
				},
			},
			tx,
		);

		return row;
	});

	return {
		payment,
		paymentUrl: session.redirectUrl,
	};
};

export const InvoiceServices = {
	getMyInvoices,
	getRoomInvoices,
	createUtilityBill,
	payInvoice,
};
