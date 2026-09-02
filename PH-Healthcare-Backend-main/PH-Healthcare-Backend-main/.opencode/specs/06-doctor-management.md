# Spec: Doctor Management

## Overview

Everything around doctor profiles after application: a doctor updates their own profile; admins list all doctors; public (unauthenticated) endpoints power patient discovery — doctors available today, a searchable doctor list, and a single doctor's public profile. Blocking/unblocking a doctor is planned (Project Requirements §2.1, §5).

## Depends on

- `prisma/schema/doctor.prisma` — Doctor (`verificationStatus`, `consultationFee Decimal`, `isDeleted`, `schedules`)
- `prisma/schema/schedule.prisma` — Schedule (`status`, `availableSlots`, `startDateTime`)
- `prisma/schema/enums.prisma` — `DoctorVerificationStatus`, `ScheduleStatus`
- `src/app/module/doctor/doctor.service.ts` — `updateDoctorProfile`, `getAllDoctors`, `getAvailableDoctorByTodaysSchedule`, `getAllDoctorsListPublic`, `getSingleDoctorPublicProfile`
- `src/app/module/doctor/doctor.interface.ts` — `IUpdateDoctorProfilePayload`
- `src/app/middleware/checkAuth.ts` — `auth(Role.ADMIN, Role.SUPER_ADMIN)` / `auth(Role.DOCTOR)`
- `src/app/interfaces/index.ts` — `IQuery`

## Database changes

None.

## Routes

- `PATCH /api/v1/doctor/update-my-profile` — `auth(Role.DOCTOR)`. Body validated by `UpdateDoctorProfileValidationZodSchema` (`address?`, `bio?`, `consultationFee?`, `contactNumber?`).
- `GET /api/v1/doctor/all-doctors` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Query: `searchTerm`, `specialization`, `email`, `licenseNumber`, `verificationStatus`, plus `page/limit/sortBy/sortOrder`. Returns `{ data, meta }`.
- `GET /api/v1/doctor/public/available-today` — public. Approved, non-deleted doctors with a published schedule today that hasn't started and has open slots. Query: `searchTerm`, `specialization`, `page/limit/sortBy/sortOrder`. Returns `{ data, meta }` with each schedule's `startDateTime`, `endDateTime`, `availableSlots`, `totalSlots`.
- `GET /api/v1/doctor/public/all-doctors` — public. Approved, non-deleted doctors. Query: `searchTerm`, `specialization`, pagination. Returns `{ data, meta }`.
- `GET /api/v1/doctor/public/:doctorId` — public. Approved, non-deleted doctor profile; 404 otherwise.

Planned:
- `PATCH /api/v1/doctor/block-unblock/:doctorId` — `auth(Role.ADMIN, Role.SUPER_ADMIN)` (§2.1). Body `{ isBlocked: boolean }` → maps to `User.status = BLOCKED | ACTIVE` for the linked user.

## Service functions

```
src/app/module/doctor/doctor.service.ts
  updateDoctorProfile(payload: IUpdateDoctorProfilePayload, user: RequestUser)
    - findUnique doctor by { userId: user.userId } → 404 if missing
    - prisma.doctor.update with the validated payload

  getAllDoctors(query: IQuery) / getAllDoctorsListPublic(query) / getAvailableDoctorByTodaysSchedule(query)
    - standard IQuery pagination: limit/page/skip/sortBy/sortOrder + andConditions
    - searchTerm against name/email/specialization (+ qualifications for list)
    - public endpoints always filter verificationStatus APPROVED + isDeleted false
    - public endpoints use select (never include) to avoid leaking resume/additionalFiles/review metadata

  getSingleDoctorPublicProfile(doctorId: string)
    - findUnique with { isDeleted: false, verificationStatus: APPROVED }; 404 if missing
    - select only safe public fields

  blockUnblockDoctor(doctorId, isBlocked)  // planned
    - findUnique doctor → resolve linked userId → prisma.user.update status BLOCKED|ACTIVE
```

## Validation schemas

```
src/app/module/doctor/doctor.validation.ts
  UpdateDoctorProfileValidationZodSchema
    - address? min 5, bio? max 1000, consultationFee? z.number().min(0), contactNumber? min 5
  BlockUnblockDoctorValidationZodSchema  // planned
    - { isBlocked: z.boolean() }
```

## Files to change

`src/app/module/doctor/doctor.route.ts`, `doctor.controller.ts`, `doctor.service.ts`, `doctor.validation.ts` for the planned block/unblock additions.

## Files to create

None.

## New dependencies

No new dependencies.

## Rules for implementation

- Public endpoints must never expose `resume`, `resumePublicId`, `additionalFiles`, `reviewedBy`, `reviewAt`, `isDeleted`, or the linked user — use `select`, not `include`
- Public discovery only returns `DoctorVerificationStatus.APPROVED` and `isDeleted: false` doctors
- `available-today` uses `schedules.some` with `status: PUBLISHED`, `availableSlots: { gt: 0 }`, `startDateTime >= startOfDay(now)` and `< startOfNextDay` plus `> now`
- Admin routes follow §2.1: block/unblock of doctors allowed for Admin and Super Admin
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Doctor updates own profile via `update-my-profile`
- Admin lists doctors with search/filter/pagination
- `public/available-today` returns only approved doctors with an open published schedule starting later today
- `public/all-doctors` and `public/:doctorId` expose no resume/review fields
- (planned) admin block/unblock flips the linked user's status and a blocked doctor is rejected on next request
