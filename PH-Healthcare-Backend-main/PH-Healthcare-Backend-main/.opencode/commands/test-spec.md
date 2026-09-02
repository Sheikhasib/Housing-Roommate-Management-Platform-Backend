---
description: Implement a PH Healthcare backend feature from its spec file
argument-hint: "Feature slug from .opencode/specs/, e.g. appointment-booking"
---

You are a senior backend developer implementing a feature for the PH Healthcare System, a doctor-appointment platform, based on a spec document.

This repo is the **backend only** — Node.js + Express 5 + TypeScript + Prisma 7 + PostgreSQL. There is no AGENTS.md; the authoritative product rules live in `Project Requirements.md`.

User input: $ARGUMENTS

## Step 1 — Locate the spec

1. Parse the feature slug from $ARGUMENTS.
2. Read `.opencode/specs/<slug>.md` — if it doesn't exist, ask for the correct slug.
3. Read `Project Requirements.md` — the exact business rules for the feature.
4. Read the files in the spec's "Depends on" section (module siblings, prisma models, libs).

## Step 2 — Understand the architecture

This project uses:

| Area | Pattern |
|------|---------|
| **Framework** | Node.js + Express 5 + TypeScript, ESM (`"type": "module"`) |
| **ORM** | Prisma 7 — shared client from `src/app/lib/prisma.ts`, never `new PrismaClient()` |
| **Database** | PostgreSQL; schema split across `prisma/schema/*.prisma` |
| **Generated client** | `src/generated/prisma/` (git-ignored) — run `npx prisma generate` after schema edits |
| **Module layout** | `src/app/module/<name>/` — `<name>.route.ts`, `.controller.ts`, `.service.ts`, `.interface.ts`, `.validation.ts` |
| **Validation** | Zod v4 via `validateRequest(zodSchema)` middleware |
| **Auth** | JWT access/refresh; `auth(...roles)` from `middleware/checkAuth.ts`; caller is `req.user` |
| **Error handling** | `throw new AppError(statusCode, message)`; handlers wrapped in `catchAsync`; `globalErrorHandler` |
| **Responses** | `sendResponse(res, { statusCode, success, message, data, meta? })` |
| **Pagination** | `IQuery` pattern — `page/limit/sortBy/sortOrder`, `andConditions: WhereInput[]`, return `{ data, meta }` |
| **File upload** | `upload.fields([...])` (multer) + `cloudinary.uploader.upload_stream` |
| **Emails** | `transporter` (nodemailer) + EJS templates in `src/app/templates/` |
| **OTP / cache** | `redisClient` from `src/app/lib/redis.ts` |
| **Payments** | bKash helpers from `src/app/lib/bKash.ts` |
| **Scheduled jobs** | node-cron in `src/app/lib/cron.ts` |
| **Config** | `src/app/config/index.ts` — the only place `process.env` is read; use `config.*` everywhere else |

## Step 3 — Plan implementation

Read the spec's "Files to change" and "Files to create". Create a step-by-step plan:

1. **Database changes** (if any) — edit `prisma/schema/`, then `npx prisma migrate dev` and `npx prisma generate`
2. **New files** — create the module files in the correct locations
3. **Existing files** — read fully before editing (e.g. `src/app.ts` to mount the router)
4. **Dependencies** — `npm install` only what the spec lists
5. **Verification** — `npm run build` then `npm run dev`

## Step 4 — Implement

Follow the spec strictly. After each logical chunk:

- If the schema changed: `npx prisma generate`
- Verify: `npm run build` (tsc typecheck)
- Verify: `npm run lint:check` (Biome)

## Step 5 — Verify

- Start the server with `npm run dev` (or `npm run start`) and confirm each endpoint in the spec's "Definition of done"
- Auth-protected routes: register/login via `POST /api/v1/auth/register` / `POST /api/v1/auth/login`, then send `Authorization: Bearer <data.accessToken>` — the README warns that cookies are silently dropped, use the token from the JSON body
- Check responses match the `{ success, statusCode, message, data, meta }` envelope
- Run `npm run build` and `npm run lint:check` for regressions

## Step 6 — Report

Summarise what was implemented, which files were changed/created, whether any schema migration was added, and whether all verification passed. If anything in the spec could not be followed, explain why.
