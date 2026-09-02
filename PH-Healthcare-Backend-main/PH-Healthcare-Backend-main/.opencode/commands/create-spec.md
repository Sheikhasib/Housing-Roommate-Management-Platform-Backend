---
description: Create a spec file for a new PH Healthcare backend feature
argument-hint: "Feature name, e.g. appointment-booking or doctor-management"
allowed-tools: Read, Write, Glob, Bash(git:*)
---

You are a senior backend developer spinning up a new feature for the PH Healthcare System, a doctor-appointment platform: patients book consultations, doctors run them, and admins approve doctors and keep the platform running.

This repo is the **backend only** — Node.js + Express 5 + TypeScript + Prisma 7 + PostgreSQL + Zod v4. No frontend code lives here; every feature is an API feature.

User input: $ARGUMENTS

## Step 1 — Parse arguments

From $ARGUMENTS extract:

| Variable | Rule | Example |
|----------|------|---------|
| `feature_title` | Title Case, human readable | "Appointment Booking" |
| `feature_slug` | kebab-case, a-z0-9, max 40 chars | `appointment-booking` |
| `branch_name` | `feat/<slug>` | `feat/appointment-booking` |

Ask the user if ambiguous.

## Step 2 — Research codebase

Read these before writing the spec:

**Existing specs** — `.opencode/specs/*.md` (read them all, avoid duplication)

**Product requirements** — `Project Requirements.md` — the authoritative rules for every feature. Cite the relevant section in the spec's Overview so implementers never guess.

**Reference module** — `src/app/module/doctor/` is the most complete module; `src/app/module/schedule/` shows the list/pagination pattern. Read the target module's siblings before writing.

**Module layout** — `src/app/module/` — each feature is exactly one folder:

| File                   | Responsibility |
|------------------------|----------------|
| `<name>.route.ts`      | Express `Router`, wires `auth(...roles)` + `validateRequest(...)`, exports `<Name>Routes` |
| `<name>.controller.ts` | Reads `req.body` / `req.params` / `req.user`, calls the service, calls `sendResponse` |
| `<name>.service.ts`    | All business logic and every Prisma call for the module |
| `<name>.interface.ts`  | TypeScript types for the module's payloads |
| `<name>.validation.ts` | Zod v4 schemas (expected for every mutating route) |

**Data model** — `prisma/schema/*.prisma` (split across files, wired by `prisma.config.ts`):
- `user.prisma` — User: `Role` (SUPER_ADMIN\|ADMIN\|DOCTOR\|PATIENT), `UserStatus` (ACTIVE\|BLOCKED\|DELETED), `AuthProvider` (GOOGLE\|CREDENTIAL), `emailVerified`, `needPasswordChange`, soft-delete (`isDeleted`/`deletedAt`)
- `doctor.prisma` — Doctor: specialization, licenseNumber (unique), consultationFee (`Decimal`), `verificationStatus` (PENDING\|APPROVED\|REJECTED), resume/additionalFiles
- `patient.prisma` — Patient
- `schedule.prisma` — Schedule: `startDateTime`/`endDateTime`, `totalSlots`/`availableSlots`, `status` (DRAFT\|PUBLISHED), `@@unique([doctorId, startDateTime, endDateTime])`
- `appointment.prisma` — Appointment: `status` (PENDING\|CONFIRMED\|CANCELLED\|ONGOING\|COMPLETED), `serialNumber`, `@@unique([patientId, doctorId, scheduleId])`
- `payment.prisma` — Payment: `status` (UNPAID\|PROCESSING\|PAID\|FAILED\|CANCELLED\|REFUNDED), bKash fields
- `enums.prisma` — every enum lives here

Generated client: `src/generated/prisma/` (git-ignored, run `npx prisma generate`). Import enums from `../../generated/prisma/enums`, where-input types from `../../generated/prisma/models`, browser types from `../../generated/prisma/browser`.

**Shared infra** — `src/app/`:
- `config/index.ts` — the only place `process.env` is read; import `config`, never `process.env` directly
- `lib/prisma.ts` — shared `prisma` instance — always import this, never `new PrismaClient()`
- `lib/redis.ts` — `redisClient` for OTPs, tokens, rate limiting
- `lib/cloudinary.ts` + `lib/multer.ts` — file uploads
- `lib/nodemailer.ts` — `transporter` + EJS templates in `src/app/templates/`
- `lib/bKash.ts` — bKash grant-token/API helpers
- `lib/cron.ts` — scheduled jobs (node-cron)
- `middleware/checkAuth.ts` — `auth(...roles)` guard; populates `req.user` as `RequestUser { userId, email, name, role }`
- `middleware/validateRequest.ts` — `validateRequest(zodSchema)` → assigns `req.body = result.data`
- `utils/catchAsync.ts` — wrap handlers so thrown errors reach the error handler
- `utils/AppError.ts` — `throw new AppError(statusCode, message)`
- `utils/sendResponse.ts` — `{ success, statusCode, message, data, meta }` envelope
- `utils/jwt.ts` — sign/verify helpers

**Route mounting** — `src/app.ts` — a new module is mounted here next to the existing lines:
```ts
app.use('/api/v1/<name>', <Name>Routes)
```

**API reference** — `L2B7 Ph-Healthcare.postman_collection.json` — check for endpoint definitions that already exist before proposing new ones.

## Step 3 — Create branch

Run:
```
git checkout -b feat/<feature_slug>
```

If branch exists, check it out instead.

## Step 4 — Write spec

Generate a spec document with this exact structure:

```
# Spec: <feature_title>

## Overview

One paragraph describing what this feature does for PH Healthcare. Reference the relevant
section of Project Requirements.md so implementers can read the exact business rules.

## Depends on

List exact file paths this feature builds on, grouped by layer:
- `prisma/schema/<model>.prisma` — models/fields used
- `src/app/module/<name>/<name>.service.ts` — existing services called into
- `src/app/lib/<file>.ts` — libs used (prisma, redis, nodemailer, cloudinary, bKash, cron)
- `src/app/middleware/checkAuth.ts` — which roles guard each route
- `src/app/utils/*` — helpers used
- `src/app/config/index.ts` — config values needed

## Database changes

Only if the schema changes:
```
prisma/schema/<model>.prisma
  add FieldName Type?        // reason, migration/backfill notes
  add relation RelationName  // reason
```
Remember: after editing, run `npx prisma migrate dev` then `npx prisma generate`.

## Routes

- `POST /api/v1/<module>/<path>` — description, auth required? roles? validated body?
- `GET /api/v1/<module>/public/<path>` — public patient-facing routes live under /public/

## Service functions

```
src/app/module/<name>/<name>.service.ts
  serviceName(args) — what it does, which Prisma calls it makes, what it returns
```

## Validation schemas

```
src/app/module/<name>/<name>.validation.ts
  XxxValidationZodSchema — what it validates and why
```

## Files to change

Exact file paths. One per line. (e.g. `src/app.ts` to mount the router, `prisma/schema/<model>.prisma`)

## Files to create

Exact file paths. One per line. The files that make up a module.

## New dependencies

List npm packages. If none: "No new dependencies."

## Rules for implementation

Specific PH Healthcare backend constraints. Always include relevant items from this list:

### Module structure
- One folder per feature: `<name>.route.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.interface.ts`, `<name>.validation.ts`
- Controllers never call Prisma directly; services never touch `req`/`res` — pass `RequestUser` when a service needs the caller
- Never spread `req.body` straight into a Prisma create/update — destructure the exact fields (or pass validated zod output)
- Validate every mutating request with `validateRequest(zodSchema)`; use Zod v4 (`z.email()`, `z.string().trim().min(...)`)
- Export the router as `<Name>Routes` and mount it in `src/app.ts` under `/api/v1/<name>`

### Auth & roles
- Guard routes with `auth(Role.X, ...)` — follow the permissions table in Project Requirements.md §2.1
- Public patient-facing routes go under a `/public/` path segment with no `auth()` guard
- Read the caller from `req.user` (set by `auth`), never trust a role/`userId` from the body

### Data access
- Import the shared `prisma` from `src/app/lib/prisma` — never `new PrismaClient()`
- Never return or select passwords — use `omit: { password: true }`
- Soft-delete via `isDeleted` / `deletedAt` — no hard deletes; check `isDeleted` in lookups
- Errors: `throw new AppError(httpStatus.CODE, "message")` — never raw `throw new Error()`
- Handlers: wrap in `catchAsync` and respond with `sendResponse(res, { statusCode, success, message, data, meta? })`
- List endpoints: follow the `IQuery` pagination pattern — `limit/page/skip/sortBy/sortOrder`, `andConditions: WhereInput[]`, `searchTerm` + filters, return `{ data, meta }` with `totalPages`
- Use `take`/`skip` for pagination, `select` (never `include`) on public endpoints so sensitive fields stay out

### Side effects
- OTPs/tokens in Redis with TTL: `redisClient.set(key, value, { expiration: { type: "EX", value } })`
- Emails via `transporter` + EJS templates in `src/app/templates/`; build the path with `path.join(process.cwd(), "src/app/templates/<name>.ejs")`
- File uploads: `upload.fields([...])` from `lib/multer` + `cloudinary.uploader.upload_stream` → store `secure_url` + `public_id`
- bKash payments via `lib/bKash` helpers; store the raw gateway response in the `Json` field
- Everything env-related reads from `config.*` — never `process.env` in application code

## Definition of done

Testable checklist. Each item verifiable by running `npm run dev` + curl / the Postman collection.
```

## Step 5 — Save

Save to: `.opencode/specs/<feature_slug>.md`

## Step 6 — Report

```
Branch:    feat/<feature_slug>
Spec file: .opencode/specs/<feature_slug>.md
Title:     <feature_title>
```

"Review the spec then ask me to implement it."

## Example output

For reference, `src/app/module/doctor/`, `schedule/`, and `appointment/` are the canonical module patterns. Read one before writing if unsure.
