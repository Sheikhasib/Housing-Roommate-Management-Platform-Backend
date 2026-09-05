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
import { prisma } from "../prisma";
import { AppError } from "../../utils/AppError";
import { writeAuditLog } from "../../utils/audit";
import { recalculateRoomStatus } from "../../utils/roomStatus";

// Shared, gateway-agnostic settlement helpers (master plan §2.1). This module
// is the ONLY place that turns a provider-verified confirmation into money
// state (PAID + lease/bed/invoice side effects + audit). Adapters are pure
// transport and never write Payment/Invoice/Lease rows themselves.

// ---- provider-reported amount check (I-G2) ----
// Adapters normalize the provider-reported amount to minor units BEFORE this
// call (bKash/SSLCommerz report BDT taka strings -> x100; Stripe already
// reports minor units).
export const verifyAmount = (
	expectedMinorUnits: number | null,
	reportedMinorUnits: number | null,
): boolean => {
	if (expectedMinorUnits === null || reportedMinorUnits === null) {
		// rows initiated before the snapshot existed settle on the row amount
		// (legacy behavior preserved for bKash flows)
		return reportedMinorUnits === null;
	}

	return expectedMinorUnits === reportedMinorUnits;
};

// ---- conditional failure/cancel writes (I-G4) ----
// Only ever downgrade a still-PROCESSING row: a late provider event can never
// clobber a PAID/REFUNDED state, and the invoice is only touched when the
// payment was actually live.
export const markFailed = async (paymentId: string, raw: unknown) => {
	const updated = await prisma.$transaction(async (tx) => {
		const result = await tx.payment.updateMany({
			where: { id: paymentId, status: PaymentStatus.PROCESSING },
			data: { status: PaymentStatus.FAILED, gatwayResponse: raw as any },
		});

		if (result.count === 0) {
			return { changed: false };
		}

		const payment = await tx.payment.findUniqueOrThrow({
			where: { id: paymentId },
			select: { invoiceId: true },
		});

		if (payment.invoiceId) {
			await tx.invoice.update({
				where: { id: payment.invoiceId },
				data: { status: InvoiceStatus.FAILED },
			});
		}

		await writeAuditLog(
			{
				action: "PAYMENT_FAILED",
				entity: "Payment",
				entityId: paymentId,
				actorRole: "SYSTEM",
				before: { status: PaymentStatus.PROCESSING },
				after: { status: PaymentStatus.FAILED },
			},
			tx,
		);

		return { changed: true };
	});

	return updated;
};

export const markCancelled = async (paymentId: string, raw: unknown) => {
	const updated = await prisma.$transaction(async (tx) => {
		const result = await tx.payment.updateMany({
			where: { id: paymentId, status: PaymentStatus.PROCESSING },
			data: { status: PaymentStatus.CANCELLED, gatwayResponse: raw as any },
		});

		if (result.count === 0) {
			return { changed: false };
		}

		const payment = await tx.payment.findUniqueOrThrow({
			where: { id: paymentId },
			select: { invoiceId: true },
		});

		if (payment.invoiceId) {
			await tx.invoice.update({
				where: { id: payment.invoiceId },
				data: { status: InvoiceStatus.UNPAID },
			});
		}

		await writeAuditLog(
			{
				action: "PAYMENT_CANCELLED",
				entity: "Payment",
				entityId: paymentId,
				actorRole: "SYSTEM",
				before: { status: PaymentStatus.PROCESSING },
				after: { status: PaymentStatus.CANCELLED },
			},
			tx,
		);

		return { changed: true };
	});

	return updated;
};

// ---- DEPOSIT payment succeeds -> create the lease & occupy the bed ----
// (moved from payment.service.ts; identical logic except the owner-lookup
// fix documented at the notification below)
export const handleDepositSuccess = async (
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

	// notify the owner that a tenant is locked in. The owner is resolved
	// through the room's property (rooms carry no direct owner reference);
	// the pre-existing room.ownerId lookup here always crashed the settle
	// transaction, so no deposit callback could ever complete.
	const ownerProfile = await tx.ownerProfile.findFirst({
		where: { properties: { some: { id: application.room.propertyId } } },
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
// (moved verbatim from payment.service.ts; byte-identical logic)
export const handleInvoiceSuccess = async (
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

// ---- the single provider-verified settle entry point ----
// Verifies the provider-reported amount (I-G2, minor units) and dispatches to
// the deposit/invoice settle paths. Returns the raw settle result so callers
// keep their existing receipt/notification side effects. An optional `tx`
// lets the admin reconciliation path fold the settle into its own
// transaction (PENDING_SETTLEMENT_RESOLVED stays atomic with the money move).
export const settleFromProvider = async (
	{
		paymentId,
		executedResult,
		reportedAmountMinorUnits,
		actorId,
		actorEmail,
		actorRole,
		gateway,
	}: {
		paymentId: string;
		executedResult: Record<string, unknown>;
		reportedAmountMinorUnits: number | null;
		actorId?: string;
		actorEmail?: string;
		actorRole?: string;
		gateway: string;
	},
	tx?: any,
) => {
	const db = tx ?? prisma;
	const payment = await db.payment.findUnique({
		where: { id: paymentId },
	});

	if (!payment) {
		throw new AppError(httpStatus.NOT_FOUND, "Payment not found");
	}

	// idempotent: an already-settled payment is a no-op
	if (payment.status === PaymentStatus.PAID) {
		return { outcome: "ALREADY_SETTLED" as const, result: null };
	}

	// I-G2: provider-reported amount must match the initiation snapshot
	if (!verifyAmount(payment.providerChargeAmount, reportedAmountMinorUnits)) {
		await writeAuditLog({
			action: "PAYMENT_AMOUNT_MISMATCH",
			entity: "Payment",
			entityId: paymentId,
			actorId: actorId ?? null,
			actorEmail: actorEmail ?? null,
			actorRole: actorRole ?? "SYSTEM",
			before: { status: payment.status },
			after: {
				expected: payment.providerChargeAmount,
				reported: reportedAmountMinorUnits,
				gateway,
			},
		});

		return { outcome: "AMOUNT_MISMATCH" as const, result: null };
	}

	const isDeposit = payment.purpose === PaymentPurpose.DEPOSIT;

	// audit atomically with the money transition (I-G6): a rolled-back settle
	// must never leave a PAYMENT_SETTLED row behind
	const settleOnce = async (t: any) => {
		const result = isDeposit
			? await handleDepositSuccess(t, paymentId, executedResult)
			: await handleInvoiceSuccess(t, paymentId, executedResult);

		const alreadyPaid =
			(result as { alreadyPaid?: boolean } | null | undefined)?.alreadyPaid ===
			true;

		if (!alreadyPaid) {
			await writeAuditLog(
				{
					action: "PAYMENT_SETTLED",
					entity: "Payment",
					entityId: paymentId,
					actorId: actorId ?? null,
					actorEmail: actorEmail ?? null,
					actorRole: actorRole ?? "SYSTEM",
					before: { status: payment.status },
					after: {
						status: PaymentStatus.PAID,
						gateway,
						trxId: executedResult?.trxID ?? null,
						amountVerified: true,
					},
				},
				t,
			);
		}

		return result;
	};

	const result = tx
		? await settleOnce(tx)
		: await prisma.$transaction(settleOnce);

	return { outcome: "SETTLED" as const, result };
};
