# Spec: Analytics Dashboard

## Overview

Read-only aggregate endpoints powering dashboards for each role. Patients get their appointment counts and spend; doctors get schedule/appointment counts and earnings; admins get platform-wide counts and revenue. All metrics are computed with Prisma `count`/`aggregate` queries — no new tables.

## Depends on

- `prisma/schema/appointment.prisma`, `prisma/schema/schedule.prisma`, `prisma/schema/payment.prisma`, `prisma/schema/doctor.prisma`, `prisma/schema/patient.prisma`
- `prisma/schema/enums.prisma` — `AppointmentStatus`, `PaymentStatus`, `DoctorVerificationStatus`, `ScheduleStatus`
- `src/app/module/analytics/analytics.service.ts` — `getPatientAnalytics`, `getDoctorAnalytics`, `getAdminAnalytics`
- `src/app/middleware/checkAuth.ts` — `auth(Role.PATIENT)`, `auth(Role.DOCTOR)`, `auth(Role.ADMIN, Role.SUPER_ADMIN)`

## Database changes

None.

## Routes

- `GET /api/v1/analytics/patient-analytics` — `auth(Role.PATIENT)`.
- `GET /api/v1/analytics/doctor-analytics` — `auth(Role.DOCTOR)`.
- `GET /api/v1/analytics/admin-analytics` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`.

## Service functions

```
src/app/module/analytics/analytics.service.ts
  getAdminAnalytics()
    - doctor counts: total (isDeleted false), pending/approved/rejected by DoctorVerificationStatus
    - patient count (isDeleted false)
    - appointment counts: total, COMPLETED, CANCELLED
    - revenue: sum amount where PaymentStatus.PAID, minus sum amount where PaymentStatus.REFUNDED
    - returns { totalDoctors, totalPendingDoctorApplications, totalApprovedDoctors, totalRejectedDoctors,
                totalPatients, totalAppointments, totalCompletedAppointments, totalCancelledAppointments,
                totalRevenue, totalRefunded }

  getPatientAnalytics(user)
    - resolve patient by { userId } → 404 if missing
    - appointment counts scoped to patientId: total, CONFIRMED (upcoming), COMPLETED, CANCELLED
    - amount spent: sum of PAID payments for the patient's appointments
    - refunded: sum of REFUNDED payments for the patient's appointments
    - returns { totalAppointments, upcomingAppointments, completedAppointments, cancelledAppointments,
                totalAmountSpent, totalRefunded }

  getDoctorAnalytics(user)
    - resolve doctor by { userId } → 404 if missing
    - schedule counts scoped to doctorId (isDeleted false): total, PUBLISHED
    - appointment counts: total, CONFIRMED, ONGOING, COMPLETED, CANCELLED
    - earnings: sum PAID minus sum REFUNDED for the doctor's appointments
    - returns { totalSchedules, publishedSchedules, totalAppointments, upcomingAppointments,
                ongoingAppointments, completedAppointments, cancelledAppointments,
                totalDoctorEarnings, totalDoctorRefunded }
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

- All monetary sums use Prisma `aggregate` with `_sum` and convert `Decimal` via `.toNumber()`; revenue/earnings subtract refunded totals
- Soft-deleted doctors/patients are excluded (`isDeleted: false`); appointment counts currently count all rows
- Role scoping comes from `req.user` resolved to patient/doctor — never trust role from query params
- Each endpoint is a single-purpose route; do not fold analytics into other modules
- Errors via `AppError` (404 when no profile), handlers in `catchAsync`, responses via `sendResponse` (no meta — single object `data`)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Patient analytics return their appointment + spend/refund totals
- Doctor analytics return schedule counts, appointment breakdown, and net earnings
- Admin analytics return platform doctor/patient/appointment counts, revenue, and total refunded
- Non-matching roles get 403 from the auth guard
