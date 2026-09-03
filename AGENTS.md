# AGENTS.md

Guidelines for working in the **Housing & Roommate Management Platform** backend — an Express 5 + TypeScript + Prisma REST API (PostgreSQL, Zod, Biome, Redis, Cloudinary, Nodemailer, bKash payments). Follow these conventions; read the matching file under `.opencode/specs/` before implementing a feature.

## Commands

```
npm run dev            # tsx watch src/server.ts
npm run build          # tsc
npm run start          # node dist/src/server.js
npm run lint:check     # Biome lint ./src        (fix: npm run lint:fix)
npm run format:check   # Biome format ./src      (fix: npm run format:fix)
```

- Run `lint:check` + `format:check` + `build` after any change.
- There is **no test suite** — verify behavior by running `npm run dev` and hitting endpoints (Postman/Thunder Client).
- `prisma` CLI is driven by `prisma.config.ts` (schema dir `prisma/schema`, migrations `prisma/migrations`). Migrate/regenerate after schema edits: `npx prisma migrate dev --name <name>`; the client emits to `src/generated/prisma`.

## Architecture

- **Module per feature** under `src/app/module/<name>/`, mounted in `src/app/app.ts` at `/api/v1/<name>`.
- Standard module files: `<name>.route.ts`, `<name>.controller.ts`, `<name>.service.ts`, `<name>.validation.ts`, `<name>.interface.ts` (fewer files are fine when a module has no schemas/types).
- Exports: routes `XxxRoutes`, controller `XxxController`, services `XxxServices`, validation `XxxValidation`.
- Controllers are thin: parse request, call service, reply with `sendResponse`. Business logic + Prisma live in services. Routes declare middleware (`auth(...)`, `validateRequest`, `upload`).
- A canonical 5-file example lives at `src/app/module/roommate/`.
- Middleware: `src/app/middleware/checkAuth.ts` (`auth(...roles)`), `validateRequest.ts`, `globalErrorHandler.ts`, `notFound.ts`.
- Shared helpers: `src/app/utils/` (`AppError`, `catchAsync`, `sendResponse`, `jwt`, `writeAuditLog`, `createNotification`, `sendTemplateEmail`, `getVerifiedOwnerProfile`, `recalculateRoomStatus`, `uploadFileToCloudinary`), `src/app/lib/` (`prisma`, `redis`, `bKash`, `cloudinary`, `multer`, `rateLimiter`, `nodemailer`, `cron`, `googleAuth`).
- Roles: SUPER_ADMIN, ADMIN, OWNER, TENANT. All route guards/imports use enums from `../../../generated/prisma/enums`.

## Code style (Biome — non-negotiable)

- Tabs for indentation, double quotes, semicolons. Biome ignores `src/generated` and `src/app/templates`.
- No comments unless they explain a non-obvious decision.
- Import generated Prisma enums/types from `../../../generated/prisma/...` (never from `@prisma/client`).
- Type payload interfaces in `<name>.interface.ts`; do not use `any` unless required.
- ESM throughout (`type: "module"`); import config/env via `src/app/config`.

## Response & error contracts

- Every success response: `sendResponse(res, { statusCode, success: true, message, data, meta? })` → `{ success, statusCode, message, data, meta? }`. Paginated lists add `meta: { page, limit, total, totalPages }`.
- Every error: `throw new AppError(httpStatus.X, "message")` (optional `issues: [{ field, message }]`). Use `http-status` constants. Never send raw `res.json`.
- Body validation via zod in `validateRequest`; failure yields 400 with `errors: [{ field, message }]`.
- Success message text: match what the existing controller already uses for that endpoint (see specs).

## Data rules

- **Soft deletes**: `isDeleted`/`deletedAt` on long-lived models; always filter `isDeleted: false`.
- **Transactions**: wrap multi-step, money, or occupancy writes in `prisma.$transaction`. Prevent double-booking with conditional writes (e.g. `room.updateMany({ where: { occupiedBeds: { lt: bedCount } } }, { occupiedBeds: { increment: 1 } })`).
- **Occupancy**: rooms track `bedCount`/`occupiedBeds`; one ACTIVE lease = one bed. After any occupancy change call `recalculateRoomStatus(roomId, tx)` (respects MAINTENANCE).
- **Money**: all amounts `Decimal(10,2)`. Payment/invoice statuses change **only** via the public bKash callback (`GET /api/v1/payment/callback`) — never set PAID manually. Initiation upserts a PROCESSING Payment keyed on `applicationId` or `invoiceId`.
- **Redis**: cache hot reads (public room search `room-public:...` EX 60s, roommate matches `roommate-match:<id>` EX 300s, bKash tokens) in try/catch — must fail soft. OTP keys `register-otp|register-data|forgot-password-otp:<email>` EX 300s.
- **Audit logs**: write `writeAuditLog` for approvals, status changes, role changes, terminations, refunds.
- **Notifications**: `createNotification({ userId, type, title, message, data? })`; `NotificationType` is required.
- **Owners**: before any property/room/lease write call `getVerifiedOwnerProfile(user.userId)` (requires APPROVED). Scope all queries by `req.user.userId`.
- Use `select`/`include` (never wide `*`). List endpoints paginate/filter/sort via `IQuery` (`searchTerm`, `page`, `limit`, `sortBy`, `sortOrder`).
- Cron (daily 00:10 rent invoices, 00:15 lease finalization, 00:20 application expiry) lives in `src/app/lib/cron.ts`; keep them idempotent.

## Verification notes

- Server seeds demo accounts on boot: `superadmin@housing.com`, `admin@housing.com`, `owner@housing.com` (APPROVED, has a property + rooms), `tenant@housing.com` — creds in `.env`/`.env.example`.
- If Redis/email are down the server still boots (fail-soft); OTP and payment flows need them working.
