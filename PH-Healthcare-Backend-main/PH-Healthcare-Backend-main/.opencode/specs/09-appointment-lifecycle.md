# Spec: Appointment Lifecycle

## Overview

After booking, an appointment moves `PENDING → CONFIRMED → ONGOING → COMPLETED`. The doctor drives `CONFIRMED → ONGOING` and `ONGOING → COMPLETED`; patients/admins can cancel subject to a refund rule — cancelling more than 1 hour before the schedule start refunds the bKash payment, otherwise cancellation happens without refund (Project Requirements §8, §10). Patients, doctors, and admins each get scoped appointment lists, and any participant can view a single appointment.

## Depends on

- `prisma/schema/appointment.prisma` — Appointment (`status`, `serialNumber`, `joiningTime`)
- `prisma/schema/schedule.prisma` — Schedule (`availableSlots`, `startDateTime`)
- `prisma/schema/payment.prisma` — Payment (refund fields)
- `prisma/schema/enums.prisma` — `AppointmentStatus`, `PaymentStatus`, `Role`
- `src/app/module/appointment/appointment.service.ts` — `updateAppointmentStatus`, `cancelAppointment`, `getMyAppointments`, `getDoctorAppointments`, `getAllAppointments`, `getSingleAppointment`
- `src/app/lib/bKash.ts` — `getBkashIdToken`; refund via `{bkash_base_url}/tokenized/checkout/payment/refund`
- `src/app/middleware/checkAuth.ts` — `auth(...)` per role
- `src/app/interfaces/index.ts` — `IQuery`
- `date-fns` — `isBefore`, `subHours`

## Database changes

None.

## Routes

- `PATCH /api/v1/appointment/update-status/:appointmentId` — `auth(Role.DOCTOR)`. Body `{ status: "ONGOING" | "COMPLETED" }` (validated). Enforces the strict transition order.
- `POST /api/v1/appointment/cancel-appointment` — `auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN)`. Body `{ appointmentId }`. Cancels + optionally refunds.
- `GET /api/v1/appointment/my-appointments` — `auth(Role.PATIENT)`. Query `status?`, pagination.
- `GET /api/v1/appointment/doctor-appointments` — `auth(Role.DOCTOR)`. Query `status?`, pagination.
- `GET /api/v1/appointment/all-appointments` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Query `status?`, `doctorId?`, `patientId?`, `doctorEmail?`, `patientEmail?`, pagination.
- `GET /api/v1/appointment/:appointmentId` — `auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN)`. Ownership-checked single view.

## Service functions

```
src/app/module/appointment/appointment.service.ts
  updateAppointmentStatus(appointmentId, payload, user)
    - resolve doctor by { userId }; 404 if missing
    - findUnique appointment by { id, doctorId: doctor.id }; 404 if missing
    - reject COMPLETED / CANCELLED / PENDING states
    - CONFIRMED → only allow ONGOING; ONGOING → only allow COMPLETED (else 400)
    - update and return the appointment

  cancelAppointment(payload, user) — prisma.$transaction
    - findUnique appointment by { id, patient: { email: user.email } } (include payment + schedule); 404 if missing
    - reject ONGOING / COMPLETED / already CANCELLED (409)
    - tx.appointment.update status CANCELLED
    - prisma.schedule.update availableSlots increment 1
    - refund eligibility: isBefore(now, subHours(schedule.startDateTime, 1))
    - if eligible: getBkashIdToken(); POST refund { paymentID, trxID, amount, sku, reason };
      tx.payment.update → REFUNDED + refundTrxId/refundAt/refundAmount/refundReason + gatwayResponse
    - return { appointment, payment }

  getMyAppointments(query, user) — patient-scoped list, include doctor/schedule/payment
  getDoctorAppointments(query, user) — doctor-scoped list, include patient/schedule/payment
  getAllAppointments(query) — admin list with the filters above
  getSingleAppointment(appointmentId, user)
    - include patient/doctor/schedule/payment; 404 if missing
    - PATIENT must match appointment.patient.userId; DOCTOR must match appointment.doctor.userId (403 otherwise)
```

## Validation schemas

```
src/app/module/appointment/appointment.validation.ts
  UpdateAppointmentStatusValidationZodSchema — { status: z.enum(["ONGOING", "COMPLETED"]) }
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies.

## Rules for implementation

- Status transitions are strictly ordered — a doctor cannot skip ONGOING or revert
- Cancel refund rule: refund only if now < startDateTime − 1 hour; otherwise cancel with no refund (schedule slots still restored)
- Refund amount equals the original payment `amount`; store `refundTrxId`, `refundAt`, `refundAmount`, `refundReason` on the Payment
- Appointment lists are scoped to the caller — never query by raw role from the body, always via `req.user` + resolved patient/doctor
- `getSingleAppointment` and payment/prescription single views apply the same ownership checks (PATIENT/DOCTOR 403 on foreign rows; ADMIN/SUPER_ADMIN unrestricted)
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse` (lists return `{ data, meta }`)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Doctor moves a CONFIRMED appointment to ONGOING then COMPLETED; skipping/backtracking → 400
- Cancelling >1h before start refunds via bKash and marks payment REFUNDED; within 1h cancels without refund
- Patient sees only their appointments; doctor only theirs; foreign single-appointment view → 403
- Admin `all-appointments` filters by status/doctor/patient
