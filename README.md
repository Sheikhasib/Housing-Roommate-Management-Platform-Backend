# 🏠 Housing & Roommate Management Platform — Backend

A production-style REST API for a housing & roommate ecosystem. Property owners list
verified properties and rooms; tenants search rooms, request viewings, apply, pay a
bKash booking deposit, then live under a tracked lease with monthly rent invoices,
utility bill splitting and maintenance requests. Roommate matching connects compatible
tenants through a scoring algorithm.

> Built as an assignment project following the architecture of the PH-Healthcare
> reference backend: `Routes → Controllers → Services → Prisma`, split schemas,
> Redis caching, EJS emails, Cloudinary uploads and real bKash payments.

---

## 🧰 Tech Stack

| Layer        | Technology                                              |
| ------------ | ------------------------------------------------------- |
| Runtime      | Node.js + TypeScript + Express 5                        |
| Database     | PostgreSQL + Prisma (multi-file schema, indexes, tx)    |
| Validation   | Zod 4 (middleware, structured field errors)             |
| Auth         | JWT (access/refresh) + GCP Google login + OTP via Redis |
| Caching      | Redis (OTPs, bKash tokens, roommate matches, room feed) |
| Email        | Nodemailer + EJS templates                              |
| Uploads      | Multer + Cloudinary                                     |
| Payments     | bKash Tokenized Checkout (sandbox) + PDF receipts       |
| Background   | node-cron (rent invoices, lease finalizer, expiry)      |
| Security     | helmet, cors, express-rate-limit                        |
| Quality      | Biome (lint/format)                                     |

---

## 🎭 Roles (strict RBAC)

| Role          | What they can do                                                            |
| ------------- | --------------------------------------------------------------------------- |
| **TENANT**    | Register, search rooms, request viewings, apply, pay deposit, pay invoices, maintenance, roommate matching |
| **OWNER**     | Verified by an admin; creates properties/units/rooms, sets availability, reviews applications & viewings, posts utility bills, resolves maintenance |
| **ADMIN**     | Dashboard stats, user management (block/unblock), verify owners, audit logs |
| SUPER_ADMIN   | Everything an admin can + change user roles                                 |

---

## 🔑 Demo Credentials (seeded on boot)

| Role        | Email                 | Password    |
| ----------- | --------------------- | ----------- |
| Super Admin | superadmin@housing.com | Admin@1234  |
| Admin       | admin@housing.com      | Admin@1234  |
| Owner*      | owner@housing.com      | Owner@1234  |
| Tenant      | tenant@housing.com     | Tenant@1234 |

\*The seeded owner is pre-approved and ships with a sample property ("Green View Residence"),
a unit and two published rooms so the whole flow works out of the box.

---

## 🚀 Getting Started

```bash
npm install            # also runs `prisma generate` (postinstall)
cp .env.example .env   # fill in DATABASE_URL + services
npm run prisma:migrate # apply migrations (prisma migrate dev in local dev)
npm run dev            # tsx watch → http://localhost:5000
```

Migrations live in `prisma/migrations` and the client is generated to
`src/generated/prisma`.

### Required env variables (see `.env.example`)

`DATABASE_URL`, `JWT_*`, `GOOGLE_CLIENT_ID/SECRET`, `REDIS_*`, `SMTP_*`,
`CLOUDINARY_*`, `BKASH_*`, plus the seeded demo-account credentials.

---

## 🗂 Project Structure

```
prisma/
  schema/            # one .prisma file per domain (enums, user, property, ...)
  migrations/        # applied SQL migrations
src/
  app.ts             # express bootstrap: helmet, cors, rate limits, route mounting
  server.ts          # connect DB/Redis, verify SMTP, seed demo users, start cron
  app/
    config/          # centralised env config
    interfaces/      # shared query interface (pagination/sort/filter)
    lib/             # prisma, redis, cloudinary, bKash, nodemailer, multer, cron, rateLimiter
    middleware/      # checkAuth (RBAC), validateRequest, globalErrorHandler, notFound
    utils/           # AppError, jwt, audit, notification, email, seed, roomStatus, uploads
    templates/       # EJS email templates
    module/          # one folder per feature: auth, user, tenant, owner, property,
                     # room, viewing, roommate, application, lease, invoice,
                     # payment, maintenance, notification, admin, analytics
```

Each module follows the same pattern as the reference project:
`X.controller.ts` → `X.service.ts` (business logic + Prisma transactions) →
`X.route.ts` (versioned `/api/v1/...`) with `X.validation.ts` (Zod) and
`X.interface.ts` (payload types).

---

## 🌊 Core Business Workflows

1. **Owner onboarding** — register with role `OWNER` → verify email OTP → admin
   approves the owner profile (upload verification documents, re-submit if rejected).
2. **Listing** — approved owner creates a property → optional units → rooms → sets
   price/availability → publishes. Rooms appear in public search once published.
3. **Discovery** — public room feed (`?city=&maxRent=&type=…`, paginated, Redis-cached)
   + roommate match feed (scored by city/budget/lifestyle, cached).
4. **Engagement** — tenant requests a **viewing** (owner approves/schedules/rejects)
   or sends **roommate requests** (accept → pair).
5. **Application** — tenant applies for a room (`PENDING`) → owner **approves/rejects**
   (capacity guard prevents over-approval) → tenant pays the **booking deposit via bKash**.
6. **Lease** — deposit callback (transaction + guarded `occupiedBeds` increment) creates
   the **lease**, marks the payment `PAID` and emails a PDF receipt. Cancelling before
   move-in refunds through bKash.
7. **Billing** — a cron job issues monthly **rent invoices**; owners post **utility
   bills** that are split equally between active roommates. Each invoice is paid via bKash.
8. **Living** — tenants raise **maintenance requests** (PLUMBING/ELECTRICAL/…) with an
   owner-driven state machine; all parties get notifications + emails.
9. **Admin** — dashboard stats, block/unblock users, owner verification, audit-log trail.

---

## 🔒 Concurrency & Safety Highlights

- Booking deposit confirmation runs in an **interactive transaction** and only increments
  `occupiedBeds` with `occupiedBeds < bedCount` (`updateMany`), so two tenants can never
  claim the same bed.
- Application **capacity guard** blocks owners from approving more applicants than free beds.
- Lease completion/termination **releases** the bed and recalculates room status.
- **Soft deletes** everywhere (`isDeleted`/`deletedAt`); **audit logs** on approvals,
  reviews, role/status changes, refunds.
- Zod validation returns `{ success:false, message, errors:[{field,message}] }`.
- Every response follows `{ success, message, data, meta? }`.

---

## 📬 bKash Flow

```
POST /application/:id/pay-deposit    → creates checkout session, returns bkashURL
user pays on bKash page
GET  /payment/callback?paymentID=…&status=success|failure|cancel
     → execute payment on gateway → update Payment/Invoice/Lease → redirect to frontend
```

Access & refresh tokens are cached in Redis; refunds are issued via
`tokenized/checkout/payment/refund`.

---

## 📡 API Surface (all under `/api/v1`)

```
auth       POST register, verify-email, login, refresh-token, google, logout,
           forgot-password, reset-password | GET me
user       PATCH update-me, profile-image
tenant     GET me | PATCH update-me
owner      GET me | PATCH update-me | POST verification-documents | PATCH verify
property   POST / | GET my-properties, public | PATCH/DELETE :id | POST :id/units | images
room       POST / | GET my-rooms, public | PATCH :id, :id/availability | DELETE :id | images
viewing    POST / | GET my-requests, owner-requests | PATCH :id/status
roommate   GET match, my-pairs | POST request | GET my-requests | PATCH request/:id/respond
application POST apply | GET my-applications, owner-applications | GET/PATCH :id
            POST :id/pay-deposit, :id/cancel
lease      GET my-leases, owner-leases, :leaseId | POST :id/terminate | documents
invoice    GET my-invoices | POST utility-bill | GET room/:roomId | POST :id/pay
payment    GET callback (bKash), my-payments | admin all-payments | GET :paymentId
maintenance POST / | GET my-requests, owner-requests | PATCH :id/status | image
notification GET my-notifications, unread-count | PATCH read-all, :id/read
admin      GET dashboard-stats, users, audit-logs | PATCH users/:id/status, users/:id/role
analytics  GET tenant-analytics, owner-analytics
```

Import **`Housing-Roommate-API.postman_collection.json`** (repo root) for a fully
documented collection with examples for every role.

---

## ☁️ Deployment

The API is a standard Node/Express process — deployable on **Render**, **Railway**,
**Fly.io** or a VPS:

- **Render (blueprint)**: see `render.yaml` — `npm start` boots the API (tsx), and
  `postinstall` regenerates the Prisma client. Set all `.env.example` variables in the
  dashboard, run `prisma migrate deploy`, then open `/` and `/api/v1/health`.
- Remember to point `FRONTEND_URL`, `BACKEND_URL` and `BKASH_CALLBACK_URL`
  (format `https://your-api.com/api/v1`) at the live domain.

---

## ✅ Scripts

| Command                  | Purpose                       |
| ------------------------ | ----------------------------- |
| `npm run dev`            | run with hot reload (tsx)     |
| `npm start`              | production boot               |
| `npm run build`          | type-check + emit `dist`      |
| `npm run lint:check`     | Biome lint                    |
| `npm run format:check`   | Biome format                  |

> ⚠️ This machine uses a folder name containing `&`, which breaks the default
> `prisma` npx shim on Windows. The repo therefore invokes Prisma through
> `node node_modules/prisma/build/index.js …` in scripts — that is intentional and
> works identically on normal folder names.
