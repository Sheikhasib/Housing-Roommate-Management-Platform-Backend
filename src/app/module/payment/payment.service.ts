import PDFDocument from "pdfkit";
import httpStatus from "http-status";
import {
	ApplicationStatus,
	InvoiceStatus,
	LeaseStatus,
	NotificationType,
	PaymentPurpose,
	PaymentStatus,
} from "../../../generated/prisma/enums";
import { addMonths } from "date-fns";
import config from "../../config";
import type { IQuery } from "../../interfaces";
import type { PaymentWhereInput } from "../../../generated/prisma/models";
import { prisma } from "../../lib/prisma";
import { executeBkashPayment } from "../../lib/bKash";
import type { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { recalculateRoomStatus } from "../../utils/roomStatus";

// Build a PDF receipt buffer (invoice style) for an email attachment.
const buildReceiptPdf = async (
	lines: { label: string; value: string }[],
): Promise<Buffer> => {
	const pdfDocument = new PDFDocument({ margin: 50 });
	const pdfChunks: Buffer[] = [];

	pdfDocument.on("data", (chunk: Buffer) => pdfChunks.push(chunk));

	const pdfReadyPromise = new Promise<Buffer>((resolve) => {
		pdfDocument.on("end", () => resolve(Buffer.concat(pdfChunks)));
	});

	pdfDocument.fontSize(20).text("Housing & Roommate", { align: "center" });
	pdfDocument.fontSize(13).text("Payment Receipt", { align: "center" });
	pdfDocument.moveDown(2);

	lines.forEach((line) => {
		pdfDocument.fontSize(11).text(`${line.label}: ${line.value}`);
	});

	pdfDocument.end();
	return pdfReadyPromise;
};

// ---- DEPOSIT payment succeeds -> create the lease & occupy the bed ----
const handleDepositSuccess = async (
	tx: any,
	paymentId: string,
	executedResult: any,
) => {
	const payment = await tx.payment.findUnique({
		where: { id: paymentId },
	});

	if (!payment || payment.purpose !== PaymentPurpose.DEPOSIT) {
		throw new AppError(httpStatus.NOT_FOUND, "Deposit payment not found");
	}

	// idempotent - ignore a repeated callback for an already confirmed payment
	if (payment.status === PaymentStatus.PAID) {
		return { alreadyPaid: true, applicationId: payment.applicationId };
	}

	const application = await tx.application.findUnique({
		where: { id: payment.applicationId },
		include: { room: true, tenantProfile: true },
	});

	if (!application || application.isDeleted) {
		throw new AppError(httpStatus.NOT_FOUND, "Application not found");
	}

	if (application.status !== ApplicationStatus.APPROVED) {
		throw new AppError(
			httpStatus.CONFLICT,
			"Application is no longer approved. Deposit cannot be confirmed.",
		);
	}

	const existingLease = await tx.lease.findUnique({
		where: { applicationId: application.id },
	});

	if (existingLease) {
		// already moved in from a previous successful callback
		return { alreadyPaid: true, applicationId: application.id };
	}

	const now = new Date();
	const startDate =
		application.moveInDate.getTime() > now.getTime()
			? application.moveInDate
			: now;

	// optimistic capacity guard: only increment when a bed is actually free.
	// This is what prevents two tenants from double-booking the same bed.
	const roomUpdate = await tx.room.updateMany({
		where: {
			id: application.room.id,
			occupiedBeds: { lt: application.room.bedCount },
		},
		data: { occupiedBeds: { increment: 1 } },
	});

	if (roomUpdate.count === 0) {
		throw new AppError(
			httpStatus.CONFLICT,
			"No bed is available in this room anymore.",
		);
	}

	const endDate = addMonths(startDate, application.leaseMonths);

	const lease = await tx.lease.create({
		data: {
			applicationId: application.id,
			tenantProfileId: application.tenantProfileId,
			roomId: application.roomId,
			startDate,
			endDate,
			monthlyRent: application.room.monthlyRent,
			depositAmount: payment.amount,
			status: LeaseStatus.ACTIVE,
		},
	});

	await tx.payment.update({
		where: { id: payment.id },
		data: {
			status: PaymentStatus.PAID,
			bKashTrxId: executedResult.trxID,
			paidAt: executedResult.paymentExecuteTime,
			gatwayResponse: executedResult,
		},
	});

	await recalculateRoomStatus(application.room.id, tx);

	// notify the owner that a tenant is locked in
	const ownerProfile = await tx.ownerProfile.findUnique({
		where: { id: application.room.ownerId },
	});

	if (ownerProfile) {
		await tx.notification.create({
			data: {
				userId: ownerProfile.userId,
				type: NotificationType.LEASE,
				title: "New tenant confirmed 🎉",
				message: `${application.tenantProfile.name} paid the deposit for "${application.room.name}". Lease starts ${startDate.toDateString()}.`,
				data: { leaseId: lease.id },
			},
		});
	}

	return { application, lease, payment, startDate };
};

// ---- RENT / UTILITY invoice payment succeeds ----
const handleInvoiceSuccess = async (
	tx: any,
	paymentId: string,
	executedResult: any,
) => {
	const payment = await tx.payment.findUnique({
		where: { id: paymentId },
		include: {
			invoice: {
				include: { lease: { include: { tenantProfile: true } } },
			},
		},
	});

	if (!payment || !payment.invoice) {
		throw new AppError(httpStatus.NOT_FOUND, "Invoice payment not found");
	}

	if (payment.status !== PaymentStatus.PAID) {
		await tx.invoice.update({
			where: { id: payment.invoiceId },
			data: { status: InvoiceStatus.PAID },
		});

		await tx.payment.update({
			where: { id: payment.id },
			data: {
				status: PaymentStatus.PAID,
				bKashTrxId: executedResult.trxID,
				paidAt: executedResult.paymentExecuteTime,
				gatwayResponse: executedResult,
			},
		});
	}

	return { invoice: payment.invoice };
};

// The bKash callback URL. bKash redirects the user here after they finish
// (success / failure / cancel) on the payment page.
const paymentCallback = async (query: Record<string, any>) => {
	const paymentID = query.paymentID;
	const status = query.status;

	if (!paymentID || !status) {
		throw new AppError(httpStatus.BAD_REQUEST, "Invalid bKash callback query");
	}

	// execute the payment to read its final state from the gateway
	const executedResult = await executeBkashPayment(paymentID);

	// find the local payment row by the gateway payment id (or invoice number)
	const payment = await prisma.payment.findFirst({
		where: {
			OR: [
				{ bKashPaymentId: paymentID },
				{ merchantInvoiceNumber: executedResult?.merchantInvoiceNumber },
			],
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	const isDeposit = payment.purpose === PaymentPurpose.DEPOSIT;

	if (status === "success") {
		if (isDeposit) {
			const result = await prisma.$transaction(async (tx) =>
				handleDepositSuccess(tx, payment.id, executedResult),
			);

			// when a lease is freshly created, email the tenant the receipt
			if (!result.alreadyPaid) {
				const { application, lease, payment: paymentRow } = result;

				const receiptPdf = await buildReceiptPdf([
					{ label: "Receipt Type", value: "Booking Deposit" },
					{ label: "Tenant Name", value: application.tenantProfile.name },
					{ label: "Tenant Email", value: application.tenantProfile.email },
					{ label: "Room", value: application.room.name },
					{ label: "Lease Start", value: lease.startDate.toDateString() },
					{ label: "Lease End", value: lease.endDate.toDateString() },
					{ label: "Amount Paid", value: `${paymentRow.amount} BDT` },
					{ label: "Transaction Id", value: executedResult.trxID },
					{ label: "Paid At", value: executedResult.paymentExecuteTime },
				]);

				await sendTemplateEmail({
					to: application.tenantProfile.email,
					subject: "Your Booking Deposit Receipt - Housing & Roommate",
					template: "payment-receipt",
					data: { name: application.tenantProfile.name },
					attachments: [
						{ filename: "deposit-receipt.pdf", content: receiptPdf },
					],
				});

				await createNotification({
					userId: application.tenantProfile.userId,
					type: NotificationType.PAYMENT,
					title: "Deposit paid ✅",
					message: `Your booking deposit for "${application.room.name}" was received. Your lease is now active.`,
					data: { leaseId: lease.id },
				});
			}

			return {
				redirectUrl: `${config.frontend_url}/dashboard/my-applications?status=success`,
			};
		}

		// RENT / UTILITY invoice payment
		const result = await prisma.$transaction(async (tx) =>
			handleInvoiceSuccess(tx, payment.id, executedResult),
		);

		await createNotification({
			userId: result.invoice.lease.tenantProfile.userId,
			type: NotificationType.PAYMENT,
			title: "Invoice paid 💰",
			message: `Your ${result.invoice.type.toLowerCase()} invoice of ৳${result.invoice.amount} was paid successfully.`,
			data: { invoiceId: result.invoice.id },
		});

		return {
			redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=success`,
		};
	}

	if (status === "failure" || status === "cancel") {
		const newStatus =
			status === "failure" ? PaymentStatus.FAILED : PaymentStatus.CANCELLED;

		await prisma.$transaction(async (tx) => {
			await tx.payment.update({
				where: { id: payment.id },
				data: {
					status: newStatus,
					gatwayResponse: executedResult,
				},
			});

			if (!isDeposit && payment.invoiceId) {
				await tx.invoice.update({
					where: { id: payment.invoiceId },
					data: {
						status:
							status === "failure"
								? InvoiceStatus.FAILED
								: InvoiceStatus.UNPAID,
					},
				});
			}
		});

		return {
			redirectUrl: `${config.frontend_url}/dashboard/my-invoices?status=${status}`,
		};
	}

	// unknown bKash status
	return {
		redirectUrl: `${config.frontend_url}?payment=error`,
	};
};

// TENANT: payments I made
const getMyPayments = async (user: RequestUser, query: IQuery) => {
	const tenantProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	if (!tenantProfile) {
		throw new AppError(httpStatus.NOT_FOUND, "Tenant profile not found");
	}

	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: PaymentWhereInput[] = [
		{
			OR: [
				{ application: { tenantProfileId: tenantProfile.id } },
				{ invoice: { lease: { tenantProfileId: tenantProfile.id } } },
			],
		},
	];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.purpose) {
		andConditions.push({ purpose: query.purpose });
	}

	const payments = await prisma.payment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			application: {
				select: {
					id: true,
					status: true,
					room: { select: { id: true, name: true } },
				},
			},
			invoice: {
				select: { id: true, type: true, amount: true, dueDate: true },
			},
		},
	});

	const total = await prisma.payment.count({ where: { AND: andConditions } });

	return {
		data: payments,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// ADMIN: all payments
const getAllPayments = async (query: IQuery) => {
	const limit = query.limit ? Number(query.limit) : 10;
	const page = query.page ? Number(query.page) : 1;
	const skip = (page - 1) * limit;

	const andConditions: PaymentWhereInput[] = [];

	if (query.status) {
		andConditions.push({ status: query.status });
	}
	if (query.purpose) {
		andConditions.push({ purpose: query.purpose });
	}

	const payments = await prisma.payment.findMany({
		where: { AND: andConditions },
		take: limit,
		skip,
		orderBy: { createdAt: "desc" },
		include: {
			application: {
				select: {
					id: true,
					tenantProfile: { select: { id: true, name: true, email: true } },
				},
			},
			invoice: {
				select: {
					id: true,
					type: true,
					lease: {
						select: {
							tenantProfile: { select: { id: true, name: true, email: true } },
						},
					},
				},
			},
		},
	});

	const total = await prisma.payment.count({ where: { AND: andConditions } });

	return {
		data: payments,
		meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
	};
};

// Single payment detail (participant/admin)
const getSinglePayment = async (paymentId: string, user: RequestUser) => {
	const payment = await prisma.payment.findUnique({
		where: { id: paymentId },
		include: {
			application: {
				include: {
					tenantProfile: { select: { id: true, name: true, email: true } },
				},
			},
			invoice: {
				include: {
					lease: {
						include: {
							tenantProfile: { select: { id: true, name: true, email: true } },
						},
					},
				},
			},
		},
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	const tenantProfileId = payment.application?.tenantProfileId
		? payment.application.tenantProfileId
		: payment.invoice?.lease.tenantProfileId;

	const payerProfile = await prisma.tenantProfile.findUnique({
		where: { userId: user.userId },
	});

	const isPayer = payerProfile && payerProfile.id === tenantProfileId;
	const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

	if (!isPayer && !isAdmin) {
		throw new AppError(httpStatus.FORBIDDEN, "You cannot view this payment");
	}

	return payment;
};

export const PaymentServices = {
	paymentCallback,
	getMyPayments,
	getAllPayments,
	getSinglePayment,
};
