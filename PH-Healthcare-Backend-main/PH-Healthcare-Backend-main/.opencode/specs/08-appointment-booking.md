# Spec: Appointment Booking

## Overview

A patient books an appointment by picking a schedule. Booking validates visibility rules (published schedule, today only, before start time, not fully booked, no existing conflicting appointment), creates a `PENDING` appointment + bKash payment record, and returns the bKash checkout URL. After the patient pays, bKash redirects to a callback which confirms the appointment, assigns a serial number + joining time, decrements the schedule's `availableSlots`, marks the payment PAID, and emails a PDF invoice (Project Requirements §7, §8).

## Depends on

- `prisma/schema/appointment.prisma` — Appointment (`status`, `serialNumber`, `joiningTime`, `@@unique([patientId, doctorId, scheduleId])`)
- `prisma/schema/payment.prisma` — Payment (`merchantInvoiceNumber` = appointment id, bKash fields, `gatwayResponse Json`)
- `prisma/schema/schedule.prisma` — Schedule (`availableSlots`, `meetingLink`)
- `prisma/schema/doctor.prisma` — Doctor (`consultationFee Decimal`)
- `prisma/schema/enums.prisma` — `AppointmentStatus`, `PaymentStatus`, `ScheduleStatus`
- `src/app/module/appointment/appointment.service.ts` — `bookAppointment`, `payAppoinment`, `bookAppointmentCallback`
- `src/app/lib/bKash.ts` — `getBkashIdToken`
- `src/app/lib/nodemailer.ts` — `transporter`; `pdfkit` for the invoice
- `src/app/middleware/checkAuth.ts` — `auth(Role.PATIENT)`
- `src/app/config/index.ts` — `bkash_base_url`, `bkash_app_key`, `bkash_callback_url`, `frontend_url`, `email_sender`

## Database changes

None.

## Routes

- `POST /api/v1/appointment/book-appointment` — `auth(Role.PATIENT)`. Body `{ scheduleId }` (validated). Returns `{ paymentUrl }` (bKash `bkashURL`).
- `POST /api/v1/appointment/pay-appointment` — `auth(Role.PATIENT)`. Body `{ appointmentId }`. For a PENDING appointment that already has a payment record — creates a fresh bKash checkout and returns `{ paymentUrl }`.
- `GET /api/v1/appointment/book-appointment/payment/callback` — public (bKash redirect). Reads `paymentID` + `status` query params, executes the payment, confirms/updates, redirects to `{frontend_url}/dashboard/my-appointment?status=success|failure|cancel|error=payment-failed`.

## Service functions

```
src/app/module/appointment/appointment.service.ts
  bookAppointment(payload: IBookAppointmentPayload, user) — prisma.$transaction
    - resolve patient by { userId } → 404 if missing
    - resolve schedule (include doctor); 404 if missing/deleted
    - reject: not PUBLISHED, not today, already started, availableSlots === 0, no consultationFee
    - reject if patient already has PENDING/CONFIRMED/ONGOING/COMPLETED appointment on this schedule
    - tx.appointment.create status PENDING
    - getBkashIdToken(); POST {bkash_base_url}/tokenized/checkout/create with
      mode 0011, payerReference = user.email, callbackURL = {bkash_callback_url}/appointment/book-appointment/payment/callback,
      amount = consultationFee.toString(), currency BDT, intent sale, merchantInvoiceNumber = appointment.id
    - tx.payment.create { amount, merchantInvoiceNumber, bKashPaymentId, payerReference, gatwayResponse, appointmentId }
    - return { paymentUrl: bKashCreatePaymentResult.bkashURL }

  payAppoinment(payload: IPayAppointmentPayload, user)
    - findUnique appointment (include schedule.doctor); 404 if missing
    - reject unless status PENDING; reject if no consultationFee
    - create bKash checkout (same payload as above, merchantInvoiceNumber = appointment id)
    - prisma.payment.update (by appointmentId) with new merchantInvoiceNumber/bKashPaymentId/gatwayResponse
    - return { paymentUrl }

  bookAppointmentCallback(query) — prisma.$transaction
    - require paymentID + status; getBkashIdToken()
    - POST {bkash_base_url}/tokenized/checkout/execute { paymentID }
    - success:
      - load appointment by merchantInvoiceNumber (include schedule/patient/doctor); 404 if missing
      - serialNumber = (totalSlots - availableSlots) + 1; joiningTime = addMinutes(startDateTime, (serialNumber-1)*20)
      - tx.appointment.update → CONFIRMED + serialNumber + joiningTime
      - prisma.schedule.update availableSlots - 1
      - tx.payment.update (by bKashPaymentId) → PAID + bKashTrxId + paidAt + gatwayResponse
      - build PDF invoice (pdfkit) and email as attachment via transporter
      - redirect success
    - failure → payment FAILED; cancel → payment CANCELLED; else redirect with error query
```

## Validation schemas

```
src/app/module/appointment/appointment.validation.ts
  BookAppointmentValidationZodSchema — { scheduleId: z.string().min(1) }
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies. (`pdfkit` already installed.)

## Rules for implementation

- Booking + payment creation run inside `prisma.$transaction`; the bKash HTTP calls happen inside the transaction as written today
- `merchantInvoiceNumber` is always the appointment id — the callback maps the bKash response back to the appointment via this field
- Serial number = `(totalSlots - availableSlots) + 1`; joining time = `startDateTime + (serialNumber - 1) * 20` minutes
- Payment updates inside the callback key off `bKashPaymentId`; schedule decrement uses the plain client (`prisma.schedule`, not `tx`) in the current code — keep consistent
- Never expose doctor `consultationFee` as anything but a string amount to bKash
- Invoice PDF must include patient name/email, doctor name/specialization, date, joining time, serial number, meeting link, amount, txn id
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`; the callback responds with `res.redirect` not `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `book-appointment` on a valid published today-schedule returns a `paymentUrl` and creates PENDING appointment + payment row
- Duplicate booking on the same schedule → 400
- `pay-appointment` on a PENDING appointment re-initiates payment
- Callback with `status=success` confirms the appointment, assigns serial + joining time, decrements slots, marks payment PAID, and emails the invoice PDF
- `status=failure|cancel` marks the payment FAILED/CANCELLED and redirects accordingly
