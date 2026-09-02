# Spec: Payment Management

## Overview

Payment history views over the `Payment` rows created by the appointment booking flow. Patients see their own payments; admins/super admins see all payments; a single payment can be fetched by the owner or an admin. This module is read-only — payments are created and mutated only by the appointment module.

## Depends on

- `prisma/schema/payment.prisma` — Payment (`status`, `amount Decimal`, `merchantInvoiceNumber`, bKash fields, refund fields)
- `prisma/schema/appointment.prisma` — Appointment relation
- `prisma/schema/doctor.prisma`, `prisma/schema/schedule.prisma` — nested includes
- `prisma/schema/enums.prisma` — `Role`
- `src/app/module/payment/payment.service.ts` — `getMyPayments`, `getAllPayments`, `getSinglePayment`
- `src/app/middleware/checkAuth.ts` — `auth(...)`
- `src/app/interfaces/index.ts` — `IQuery`

## Database changes

None.

## Routes

- `GET /api/v1/payment/my-payments` — `auth(Role.PATIENT)`. Patient-scoped. Query pagination. Returns `{ data, meta }`.
- `GET /api/v1/payment/all-payments` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Query `patientEmail?` (currently reads `query.email` — bug), pagination. Returns `{ data, meta }`.
- `GET /api/v1/payment/:paymentId` — `auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN)`. Ownership-checked (PATIENT must match `payment.appointment.patient.userId`).

## Service functions

```
src/app/module/payment/payment.service.ts
  getMyPayments(query, user)
    - resolve patient by { userId } → 404 if missing
    - PaymentWhereInput: appointment.patientId = patient.id
    - prisma.payment.findMany with include appointment → doctor (id,name,specialization) + schedule; { data, meta }

  getAllPayments(query)
    - PaymentWhereInput built from filters (patientEmail intended)
    - same includes; { data, meta }

  getSinglePayment(paymentId, user)
    - findUnique include appointment → patient/doctor/schedule; 404 if missing
    - if role PATIENT and appointment.patient.userId !== user.userId → 403
```

## Validation schemas

None — no request bodies.

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies.

## Rules for implementation

- Read-only module: never create/update Payment here — all writes happen in the appointment module
- Never expose `gatwayResponse` raw bKash internals beyond what the existing includes already return (keep current shape)
- `getMyPayments` scoping is via the patient relation, resolved from `req.user`
- Ownership check mirrors the appointment single-view rule (PATIENT 403 on foreign rows)
- Known issue to preserve/fix consciously: `getAllPayments` builds the patientEmail filter from `query.email` instead of `query.patientEmail` — align with `appointment` module semantics if touched
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse` (lists return `{ data, meta }`)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Patient sees only payments for their own appointments
- Admin sees all payments with pagination
- Patient requesting another patient's payment → 403; admin can read any payment
