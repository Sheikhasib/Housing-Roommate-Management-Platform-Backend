# Spec: Doctor Schedule

## Overview

A doctor publishes availability as one schedule per calendar date: a start/end time within a single day, a video meeting link, and a `DRAFT`/`PUBLISHED` status. Total slots are derived automatically (20 minutes per slot). A schedule is invisible to patients until published; once published, its date locks, and once a slot is booked its time range locks. Editing, publishing, and soft-deleting are doctor-only; admins can view all schedules (Project Requirements §6).

## Depends on

- `prisma/schema/schedule.prisma` — Schedule (`startDateTime`, `endDateTime`, `totalSlots`, `availableSlots`, `meetingLink`, `status`, `isDeleted`, `@@unique([doctorId, startDateTime, endDateTime])`)
- `prisma/schema/doctor.prisma` — Doctor relation
- `prisma/schema/enums.prisma` — `ScheduleStatus`
- `src/app/module/schedule/schedule.service.ts` — all ScheduleServices
- `src/app/module/schedule/schedule.interface.ts` — `ICreateSchedulePayload`, `IUpdateSchedulePayload`
- `src/app/middleware/checkAuth.ts` — `auth(Role.DOCTOR)`, `auth(Role.ADMIN, Role.SUPER_ADMIN)`
- `src/app/interfaces/index.ts` — `IQuery`
- `date-fns` — `isSameDay`, `isAfter`, `startOfDay`, `addDays`, `differenceInMinutes`

## Database changes

None.

## Routes

- `POST /api/v1/schedule/create-schedule` — `auth(Role.DOCTOR)`. Body `{ startDateTime, endDateTime, meetingLink }` (dates via `z.coerce.date`). Returns 201.
- `GET /api/v1/schedule/my-schedules` — `auth(Role.DOCTOR)`. Query `status?`, pagination. Includes appointments+patient.
- `GET /api/v1/schedule/all-schedules` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Query `doctorId?`, `email?`, `status?`, `searchTerm?`, pagination.
- `GET /api/v1/schedule/todays-schedule` — public. Requires `doctorId` query param. Returns only published, not-started, open-slot schedules for today.
- `GET /api/v1/schedule/:scheduleId` — `auth(Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN)`. Includes doctor + appointments+patient. 404 if deleted.
- `PATCH /api/v1/schedule/update-schedule/:scheduleId` — `auth(Role.DOCTOR)`. Body optional `{ startDateTime?, endDateTime?, meetingLink? }`.
- `PATCH /api/v1/schedule/publish-schedule/:scheduleId` — `auth(Role.DOCTOR)`.
- `DELETE /api/v1/schedule/:scheduleId` — `auth(Role.DOCTOR)`. Soft delete.

## Service functions

```
src/app/module/schedule/schedule.service.ts
  createSchedule(payload, user)
    - resolve doctor by { userId: user.userId } → 404 if missing
    - reject if start/end not the same calendar day (409); start after end (409)
    - reject if a non-deleted schedule already exists on that date for the doctor (409)
    - totalSlots = Math.floor(differenceInMinutes(end, start) / 20); reject if < 1
    - prisma.schedule.create { totalSlots, availableSlots: totalSlots, status default DRAFT }

  updateSchedule(scheduleId, payload, user)
    - resolve doctor + schedule (must own it); 404 if missing/deleted
    - reject update once PUBLISHED and totalSlots !== availableSlots (409)
    - coalesce fields, re-validate same-day + no-overlap + slot math (recompute totalSlots/availableSlots)

  publishSchedule(scheduleId, user)
    - owner check; 404 if missing/deleted; 409 if already PUBLISHED
    - set status PUBLISHED

  deleteSchedule(scheduleId, user)
    - owner check; 404 if missing/deleted; 409 if PUBLISHED and a slot is booked
    - soft delete { isDeleted: true, deletedAt: new Date() }

  getTodaysSchedules(query)
    - 404 if no doctorId; resolve doctor
    - filter: isDeleted false, PUBLISHED, startDateTime within today and > now, availableSlots > 0
```

## Validation schemas

```
src/app/module/schedule/schedule.validation.ts
  CreateScheduleValidationZodSchema — { startDateTime: z.coerce.date(), endDateTime: z.coerce.date(), meetingLink: z.url().trim() }
  UpdateScheduleValidationZodSchema — all optional, same rules
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies. (`date-fns` already installed.)

## Rules for implementation

- Slot length is a fixed 20 minutes (`MINUTES_ALLOCATED_PER_SLOT = 20`), consistent everywhere
- Same-day check uses `isSameDay(start, end)`; overlap check uses `startOfDay` + `addDays` (lt next-day, never lte)
- `availableSlots` initialised to `totalSlots` and decremented by the appointment callback
- Once published with bookings, schedule time/date is immutable — enforce via `totalSlots !== availableSlots`
- Soft delete only; never `prisma.schedule.delete`
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse` (with `{ data, meta }` on lists)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Create schedule returns totalSlots = floor(duration/20); a 3h range → 9 slots
- Cross-day range, start-after-end, or a second schedule the same day → 409
- Published schedule appears in `todays-schedule`; draft does not
- Update rejected once a slot is booked; publish idempotency → 409 on republish
- Delete soft-deletes and hides the schedule from all listings
