# 🏠 Housing & Roommate Management Platform — Backend API

A production-style **REST API** for a housing and roommate ecosystem. Owners list verified
properties, units and rooms; tenants search, request viewings, apply and pay a **booking deposit
through bKash, SSLCommerz or Stripe** — which atomically creates a tracked lease. A nightly cron
issues monthly rent invoices, owners post utility bills that are split between active roommates,
maintenance requests follow an owner-driven state machine, and a roommate-matching engine connects
compatible tenants before and after move-in.

Built on **Node.js · TypeScript · Express 5 · PostgreSQL · Prisma 7**, with Zod validation, JWT
auth, Redis caching, real payment-gateway integrations, EJS emails and PDF receipts.

> Reference architecture follows the classic PH-Healthcare layering — **Route → Controller →
> Service → Prisma** — extended with a gateway-neutral payment layer, property-manager delegation
> and post-lease roommate memberships.

---

## 📚 Table of Contents

1. [Key Features](#key-features)
2. [Tech Stack](#tech-stack)
3. [Roles and Permissions](#roles-and-permissions)
4. [System Architecture](#system-architecture)
5. [Project Structure](#project-structure)
6. [Database Design](#database-design)
7. [Getting Started](#getting-started)
8. [Environment Variables](#environment-variables)
9. [Demo Accounts](#demo-accounts-seeded-on-boot)
10. [Payments: Multi-Gateway Architecture](#payments-multi-gateway-architecture)
11. [Core Business Workflows](#core-business-workflows)
12. [Background Jobs (Cron)](#background-jobs-cron)
13. [Reliability and Security Highlights](#reliability-and-security-highlights)
14. [API Reference](#api-reference)
15. [Deployment](#deployment)
16. [Postman Collection](#postman-collection)

---

## ✨ Key Features

| Domain | Highlights |
| ------ | ---------- |
| **Listings** | Approved owners create properties → optional units → rooms with capacity, rent & deposit. Public search with Redis caching + filters. |
| **Discovery** | Public room/property feed; **roommate matching** scored on city, budget, lifestyle (0–100). |
| **Viewings & Applications** | Tenants request viewings and apply; owners approve/reject with a **capacity guard** against over-booking. |
| **Payments** | One money ledger, three rails: **bKash (Tokenized Checkout), SSLCommerz, Stripe** — amount-verified, provider-confirmed settlement. |
| **Leases** | Deposit success atomically creates an ACTIVE lease and consumes a bed; docs, termination and a **refund saga**. |
| **Billing** | Cron issues monthly **rent invoices**; owners post **utility bills** split equally among active roommates. |
| **Living** | Maintenance requests with an owner-driven state machine; in-app notifications + email; PDF receipts. |
| **Administration** | Dashboard stats, user block/unblock, role changes, owner/tenant verification, audit-log trail, payment reconciliation queues. |

---

## 🧰 Tech Stack

| Layer | Technology |
| ----- | ---------- |
| Runtime | Node.js + TypeScript (ESM) + Express 5 |
| Database | PostgreSQL + Prisma 7 (`@prisma/adapter-pg`, multi-file schema, client at `src/generated/prisma`) |
| Validation | Zod 4 (middleware — structured `errors: [{ field, message }]`) |
| Auth | JWT (access/refresh) + bcrypt + GCP Google OAuth + OTP flows |
| Cache | Redis (OTPs, gateway tokens, roommate matches, public feeds) |
| Email | Nodemailer + EJS templates |
| Uploads | Multer (magic-byte checks) + Cloudinary |
| Payments | **bKash** Tokenized Checkout · **SSLCommerz** · **Stripe** Checkout + PDF receipts (pdfkit) |
| Background | node-cron (rent invoices, lease finalizer, application expiry, payment reconciliation) |
| Security | helmet, CORS, express-rate-limit, provider webhook signature checks |
| Quality | Biome (lint + format) |

---

## 👥 Roles and Permissions

Strict RBAC is enforced at the route level via `auth(...roles)` and re-asserted in services.

| Role | Capabilities |
| ---- | ------------ |
| **SUPER_ADMIN** | Everything an ADMIN can do plus changing user roles (never promotable to SUPER_ADMIN). |
| **ADMIN** | Dashboard stats, block/unblock users, approve owner & tenant verification, audit logs, resolve payment refund/settlement queues. |
| **OWNER** | **Control tier** — must be admin-`APPROVED` before listing. Creates/edits/deletes own properties, units & rooms; assigns/removes Property Managers; reviews viewings/applications; posts utility bills; resolves maintenance; terminates leases. |
| **PROPERTY_MANAGER** | **Operate tier** (delegated by an Owner per property). Runs day-to-day operations on assigned properties only. **Money-blind**: never sees payment ledgers, never refunds or terminates leases, never creates/deletes property or rooms. |
| **TENANT** | Searches, applies, requests viewings, matches with roommates, must be identity-**VERIFIED** before paying deposits/invoices; manages leases, memberships, maintenance. |

Ownership and delegation are centralized in `utils/propertyAccess.ts` (`resolvePropertyRole`,
`propertyManagerScope`) so every module enforces the "owner **or** their assigned manager" check
identically — inside or outside a `$transaction`.

---

## 🗺 System Architecture

### Request lifecycle

```mermaid
flowchart LR
    Client[Web / Mobile client] -->|HTTP /api/v1/...| RL[Express Router]
    RL --> AUTH[checkAuth + RBAC]
    RL --> VAL[validateRequest · Zod]
    AUTH --> CTRL[Controller · thin]
    VAL --> CTRL
    CTRL --> SRV[Service · business logic]
    SRV -->|prisma + $transaction| DB[(PostgreSQL)]
    SRV -->|fail-soft| RC[(Redis)]
    SRV -->|after commit| SFX[Emails · PDF receipts · Notifications]
    SRV -->|provider HTTP| GW[Payment adapters]
    GW --> DB
```

Every module follows the same internal pattern:

```
<name>.route.ts  →  <name>.controller.ts  →  <name>.service.ts  →  Prisma
       │                    (thin)
   validateRequest (Zod)          └──────  + <name>.validation.ts, <name>.interface.ts
```

### Money pipeline (gateway-neutral)

```mermaid
flowchart LR
    P1[pay-deposit / pay<br/>gateway chosen] --> P2[Payment row<br/>PROCESSING + amount snapshot]
    P2 --> P3[Provider hosted page]
    P3 -->|bKash callback / SSLCommerz IPN / Stripe webhook| P4[Adapter verify<br/>trust anchor]
    P4 -->|settleFromProvider| P5[Amount re-check<br/>minor units]
    P5 -->|match| P6[Settle: PAID + side effects]
    P5 -->|mismatch| P7[Held PROCESSING<br/>admin settle queue]
```

---

## 📁 Project Structure

```
api/
  index.ts          # Vercel serverless entry (exports the Express app)
vercel.json         # Vercel builds/routes + daily cron trigger
prisma/
  schema/            # one .prisma file per domain (enums, user, property, room, ...)
  migrations/        # versioned SQL migrations
src/
  app.ts             # express bootstrap; Stripe webhook mounted BEFORE JSON parsers
  server.ts          # boot: DB → Redis (fail-soft) → SMTP → seeds → cron → listen
  app/
    config/          # centralised, typed env config
    interfaces/      # shared IQuery (searchTerm / page / limit / sort)
    lib/
      prisma.ts      # Prisma 7 + @prisma/adapter-pg singleton
      bKash.ts       # low-level bKash Tokenized Checkout HTTP client (tokens cached in Redis)
      stripe.ts      # lazy Stripe SDK singleton
      payments/      # gateway-neutral core
        types.ts     # PaymentRecord, Initiate/Verify/Refund contracts, ProviderAmbiguousError
        registry.ts  # adapter registry + listEnabledGateways + parseGateway
        settle.ts    # THE only code that turns a provider verification into money state
        adapters/    # bkash.ts · sslcommerz.ts · stripe.ts (one file per provider)
      redis.ts · nodemailer.ts · multer.ts · cloudinary.ts · cron.ts
      googleAuth.ts · rateLimiter.ts
    middleware/      # checkAuth (RBAC), optionalAuth, validateRequest,
                     # globalErrorHandler, notFound
    utils/           # AppError, catchAsync, sendResponse, jwt, audit, notification,
                     # email, seed, ownerGuard, propertyAccess, roomStatus, pdf, uploads
    templates/       # EJS email templates
    module/          # 17 feature modules
      auth/ user/ tenant/ owner/ property/ room/ viewing/ roommate/
      application/ lease/ invoice/ payment/ maintenance/ notification/
      manager/ admin/ analytics/
        <name>.interface.ts   # payload types
        <name>.validation.ts  # Zod schemas
        <name>.service.ts     # business logic + Prisma transactions
        <name>.controller.ts  # request/response wiring
        <name>.route.ts       # Express router
  generated/prisma/  # generated Prisma client (gitignored, postinstall)
```

---

## 💾 Database Design

### Models (multi-file Prisma schema)

`User`, `TenantProfile`, `OwnerProfile`, `ManagerProfile`, `Property`, `Unit`, `Room`,
`ViewingRequest`, `RoommateRequest`, `RoommatePair`, `Application`, `Lease`, `LeaseDocument`,
`Invoice`, `Payment`, `RoommateMembership`, `MaintenanceRequest`, `Notification`, `AuditLog`,
plus shared enums.

### Core domain relationships

```mermaid
erDiagram
    User ||--o| TenantProfile : has
    User ||--o| OwnerProfile : has
    User ||--o| ManagerProfile : has
    OwnerProfile ||--o{ Property : owns
    Property ||--o{ Room : contains
    TenantProfile ||--o{ Application : applies
    Room ||--o{ Application : for
    Application |o--|| Lease : becomes
    TenantProfile ||--o{ Lease : holds
    Room ||--o{ Lease : occupies
    Application |o--o| Payment : paid by
    Lease ||--o{ Invoice : billed
    Invoice |o--o| Payment : settled by
    Lease ||--o{ RoommateMembership : shares
    Property ||--o{ PropertyManager : assigned
    ManagerProfile ||--o{ PropertyManager : manages
```

### Design decisions worth knowing

- **Bed-based occupancy** — `Room.bedCount / occupiedBeds`. One ACTIVE lease = one bed; a guarded
  conditional increment (`occupiedBeds < bedCount`) prevents two tenants ever claiming the same bed.
- **Payment = a single gateway session** — one `Payment` row belongs to exactly one business
  subject: an `Application` (`DEPOSIT`) or an `Invoice` (`RENT` / `UTILITY`).
  `merchantInvoiceNumber` (the subject key) is `@unique`; provider refs are **gateway-scoped**.
- **Post-lease roommates are people, not beds** — `RoommateMembership` (max 1 ACTIVE per lease)
  never touches occupancy counters and never writes payments/invoices; lease termination and the
  completion cron cascade-close live memberships in the same transaction.
- **Soft deletes** (`isDeleted`/`deletedAt`) on long-lived models.
- **Audit log** — append-only `AuditLog` rows for approvals, status/role changes, terminations,
  refunds and stale-payment reconciliations.

---

## 🚀 Getting Started

### Prerequisites

- Node.js **≥ 20**
- PostgreSQL **≥ 14** (local or cloud — Neon/Supabase/RDS)
- Redis (optional to boot — cache/OTP fail soft, but payment & OTP flows need it)
- A bKash **sandbox** merchant account (payment gateways are env-driven)

### Local setup

```bash
# 1. Install dependencies (postinstall regenerates the Prisma client)
npm install

# 2. Configure environment
cp .env.example .env     # set DATABASE_URL + the services you intend to use

# 3. Apply migrations
npm run prisma:migrate   # `migrate dev` in local dev

# 4. Start the dev server (tsx watch) → http://localhost:5000
npm run dev
```

On boot the server connects to Postgres, **soft-connects Redis and SMTP** (failure never prevents
boot), seeds demo accounts, schedules cron jobs and **runs a one-time catch-up** of every job so
nothing is missed after downtime.

### NPM scripts

| Command | Purpose |
| ------- | ------- |
| `npm run dev` | Run with hot reload (`tsx watch src/server.ts`) |
| `npm start` | Production boot (`tsx src/server.ts`) |
| `npm run build` | Type-check + emit `dist` via `tsc` |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Run `prisma migrate dev` |
| `npm run prisma:migrate:deploy` | Apply migrations non-interactively (prod) |
| `npm run seed` | Seed demo accounts into the configured `DATABASE_URL` (for hosted DBs) |
| `npm run lint:check` / `lint:fix` | Biome lint |
| `npm run format:check` / `format:fix` | Biome format |

> **Windows note** — Prisma is invoked through `node node_modules/prisma/build/index.js …`
> (rather than the `prisma` npx shim) because a parent folder name containing `&` breaks the
> default shim on this machine. This is intentional and behaves identically on normal paths.

---

## 🔑 Environment Variables

Copy `.env.example` and fill in the services you use. Only `DATABASE_URL` + JWT secrets are
**required** to boot; Redis, SMTP, Cloudinary and the payment gateways are configured per group
below.

```env
# ── Core ────────────────────────────────────────────────────────────────
NODE_ENV=development
PORT=5000
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/housing_roommate?schema=public"
BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:3000        # CORS origin + payment return URLs
BACKEND_PUBLIC_URL=http://localhost:5000  # provider-facing notify URLs

# ── JWT ─────────────────────────────────────────────────────────────────
JWT_ACCESS_SECRET=...   JWT_ACCESS_EXPIRES_IN=1d
JWT_REFRESH_SECRET=...  JWT_REFRESH_EXPIRES_IN=7d
BCRYPT_SALT_ROUNDS=10

# ── Redis / SMTP / Cloudinary / Google ──────────────────────────────────
REDIS_USER=default   REDIS_PASSWORD=...   REDIS_HOST=localhost   REDIS_PORT=6379
SMTP_USER=...        SMTP_PASSWORD=...    EMAIL_SENDER="Housing & Roommate <...>"
CLOUDINARY_CLOUD_NAME=...   CLOUDINARY_API_KEY=...   CLOUDINARY_API_SECRET=...
GOOGLE_CLIENT_ID=...        GOOGLE_CLIENT_SECRET=...

# ── Payments ────────────────────────────────────────────────────────────
# bKash (mandatory rail — sandbox creds)
BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
BKASH_USERNAME=...   BKASH_PASSWORD=...   BKASH_APP_KEY=...   BKASH_APP_SECRET=...
BKASH_CALLBACK_URL=http://localhost:5000/api/v1

# SSLCommerz (optional — enables when store id + password are set)
SSL_COMMERZ_STORE_ID=...        SSL_COMMERZ_STORE_PASSWORD=...
SSLCOMMERZ_INIT_URL=https://sandbox.sslcommerz.com/gwprocess/v4/api.php
SSLCOMMERZ_VALIDATE_URL=https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php

# Stripe (optional — enables when the secret key is set; charges in STRIPE_CURRENCY)
STRIPE_SECRET_KEY=...          STRIPE_WEBHOOK_SECRET=...
STRIPE_CURRENCY=usd            STRIPE_BDT_TO_BASE=120

# ── Vercel Cron ─────────────────────────────────────────────────────────────
CRON_SECRET=...   # Bearer guard for /api/cron/daily (set a strong value in Vercel)
```

**Gateway enablement is env-driven.** bKash is always on; SSLCommerz appears when
`SSL_COMMERZ_STORE_ID` + `SSL_COMMERZ_STORE_PASSWORD` are set; Stripe appears when
`STRIPE_SECRET_KEY` is set. The frontend discovers exactly what to render from
`GET /api/v1/payment/gateways`.

---

## 🔑 Demo Accounts (seeded on boot)

Accounts are created idempotently on startup from the `SUPER_ADMIN_*` / `TESTER_*` variables.
Defaults (from `.env.example`):

| Role | Email | Password |
| ---- | ----- | -------- |
| Super Admin | `superadmin@housing.com` | `Admin@1234` |
| Admin | `admin@housing.com` | `Admin@1234` |
| Owner (pre-approved) | `owner@housing.com` | `Owner@1234` |
| Property Manager | `manager@housing.com` | `Manager@1234` |
| Tenant (pre-verified) | `tenant@housing.com` | `Tenant@1234` |

The seeded owner ships with a demo portfolio — property **"Green View Residence"** (Banani, Dhaka),
unit **"Flat 3B"** and two published rooms (**Room 101 – Master**, private, ৳18,000/mo; **Room 102 –
Shared**, 2 beds, ৳12,000/mo) — so the whole apply → pay → lease flow works out of the box. The
manager is pre-assigned to that property; the tenant is pre-verified for instant payments.

> Rotate these before any non-local deployment — they exist to make evaluation/demoing easy.

---

## 💳 Payments: Multi-Gateway Architecture

All money moves through **one gateway-neutral ledger** (`Payment`) in front of **three adapters**.
Adapters own only the provider HTTP calls; `lib/payments/settle.ts` is the **single** path that may
turn a provider-verified confirmation into money state.

### Where the trust anchor lives per gateway

| Gateway | Flow | Trust anchor | Notify endpoint |
| ------- | ---- | ------------ | --------------- |
| **bKash** | Tokenized Checkout — browser is redirected to a hosted page, then returns to the API | Server-side `execute` on the returned `paymentID` | `GET /api/v1/payment/callback` |
| **SSLCommerz** | Hosted payment page with a browser return **and** a server IPN | Re-validation against the SSLCommerz **validator API** (`VALID` / `VALIDATED` only) | `POST /api/v1/payment/confirm` + `POST /api/v1/payment/ipn` |
| **Stripe** | Checkout Session (hosted) — status arrives server-to-server | Signed webhook via `stripe.webhooks.constructEvent` (raw body) | `POST /api/v1/payment/webhook/stripe` |

Stripe's webhook is mounted **before** the JSON body parsers so signature verification sees the
exact request bytes, and both Stripe + SSLCommerz notify routes sit **before** the general rate
limiter so provider retries never eat the user-facing request budget.

### Lifecycle & guarantees

1. **Initiate** — `POST /application/:id/pay-deposit` or `POST /invoice/:id/pay` with
   `gateway: bkash | sslcommerz | stripe`. The provider session is created first, then a
   `PROCESSING` Payment row is upserted keyed on the application/invoice, recording the gateway, the
   provider session id and a **minor-units charge snapshot** (`providerChargeAmount`).
2. **Pay** — the tenant completes the transaction on the provider's page.
3. **Verify** — the provider notifies the API (callback / IPN / webhook). Only a **verified**
   outcome (execute OK, validator `VALID`, signed webhook `payment_status = paid`) proceeds.
4. **Settle** — `settleFromProvider` **re-checks the amount** the provider reports against the
   snapshot before touching any state. A mismatch keeps the row `PROCESSING`, writes an audit entry
   and hands it to the **admin settle queue** — it is never auto-settled. On success:
   - `DEPOSIT` → guarded `occupiedBeds` increment → ACTIVE **Lease** created → payment `PAID`.
   - `RENT`/`UTILITY` → invoice `PAID` + payment `PAID`.
   - Post-commit side effects (fail-soft): styled **PDF receipt by email** + in-app notification.
5. **Failure / cancel** — `FAILED`/`CANCELLED` via **conditional writes** (`updateMany` scoped to
   `PROCESSING`) so a late provider event can never clobber an already-settled payment. Linked
   invoices return to `UNPAID` (or `FAILED`).

### Refunds (lease termination saga)

A pre-move-in termination of a paid deposit triggers the refund flow
(`POST /lease/:leaseId/terminate`):

- The row is **reserved** `PAID → REFUND_PENDING` conditionally so only one refund attempt can ever
  run (no double refund).
- **bKash / Stripe** refund automatically; an undetermined gateway outcome
  (`ProviderAmbiguousError`) keeps the row `REFUND_PENDING` and flags it for the admin refund queue.
- **SSLCommerz** has no automated refund → the row is parked `REFUND_PENDING` and queued for a
  manual refund by support.
- A confirmed refund marks `REFUNDED` and then atomically terminates the lease and releases the bed.

### Admin reconciliation queues

Because providers sometimes never answer, admins own the two terminal queues:

| Queue | Endpoints | Purpose |
| ----- | --------- | ------- |
| Pending refunds | `GET /admin/payments/pending-refunds` · `POST …/pending-refunds/:paymentId/resolve` | Resolve `REFUND_PENDING` → `REFUNDED` or back to `PAID` |
| Pending settlements | `GET /admin/payments/pending-settlements` · `POST …/pending-settlements/:paymentId/resolve` | Stale `PROCESSING` rows whose provider verdict was lost — admin confirms settled (`SETTLED`, amount-checked through the same settle path) or not (`NOT_SETTLED`) |

A nightly cron (`reconcileStaleProcessingPayments`) probes each provider for the definitive state of
`PROCESSING` payments older than 24 h. Definitive failed/expired verdicts are downgraded (tenant can
retry); paid-or-ambiguous rows are only **flagged** into the admin settle queue — the cron **never
auto-settles**.

> **Currency** — the ledger is BDT-native (`Decimal(10,2)`). bKash/SSLCommerz charge BDT
> (×100 → paisa); Stripe charges in `STRIPE_CURRENCY` (default `usd`) by converting with
> `STRIPE_BDT_TO_BASE` (BDT per 1 base unit). The snapshot is the Stripe `unit_amount` itself, so
> settlement compares the provider's real charge against the exact snapshot rather than the
> conversion.

---

## 🌊 Core Business Workflows

1. **Onboarding** — register as `TENANT`, `OWNER` or `PROPERTY_MANAGER` → verify email OTP →
   (owners) admin approves verification documents.
2. **Listing** — approved owners create a property → optional unit → rooms → publish. Rooms appear
   in public search once published.
3. **Delegation** — owners assign Property Managers per property; managers operate on assigned
   properties with money access stripped.
4. **Discovery** — public room feed + roommate match feed (scored, Redis-cached).
5. **Engagement** — tenants request viewings (owner schedules/rejects) or send roommate requests
   (accept → pair).
6. **Application** — tenant applies (`PENDING`) → owner approves with a capacity guard → tenant
   picks a payment gateway and pays the **booking deposit**.
7. **Lease** — the verified deposit callback creates the ACTIVE lease, marks the room bed occupied
   and emails a PDF receipt. Pre-move-in cancellation triggers the refund saga.
8. **Billing** — cron issues monthly rent invoices (deposit covers month one); owners post utility
   bills that are split equally among ACTIVE roommates (last share keeps the remainder).
9. **Roommate memberships** — after move-in, a verified tenant can invite a roommate into their
   active lease's room (person-based, never occupancy/money).
10. **Living & admin** — maintenance request state machine with notifications; admins audit,
    verify, block, reconcile payments and review analytics.

---

## ⏰ Background Jobs (Cron)

All jobs are **idempotent** and run a catch-up pass on boot of a long-running
host (`npm run dev`). On **Vercel** there is no always-on process, so one daily
Vercel Cron instead triggers `GET /api/cron/daily` (guarded by `CRON_SECRET`),
which runs all four jobs in sequence:

| Schedule (host) | Job | What it does |
| -------- | --- | ------------ |
| Daily `00:10` | `generateMonthlyRentInvoices` | Creates RENT invoices for active leases from month two onward (deposit covers month one). |
| Daily `00:15` | `finalizeExpiredLeases` | Leases past their end date → `COMPLETED`; releases the bed, closes live roommate memberships, notifies members. |
| Daily `00:20` | `expirePendingApplications` | Applications `PENDING` longer than 14 days → `EXPIRED`. |
| Daily `00:25` | `reconcileStaleProcessingPayments` | Probes providers for `PROCESSING` payments > 24 h; downgrades definitive failures, flags the rest for the admin settle queue. |

---

## 🔒 Reliability and Security Highlights

- **Double-booking proof** — deposit confirmation increments `occupiedBeds` only when
  `occupiedBeds < bedCount` inside a `$transaction` (`updateMany`), so two tenants can never claim
  the same bed; approval carries the same capacity guard.
- **Provider-verified money state** — no endpoint ever sets `PAID` by hand. Payment/invoice state
  changes only via gateway-verified notifications (bKash execute, SSLCommerz validator, Stripe
  signed webhook) or the admin settle queue, with signature verification and idempotent replay
  guards throughout.
- **Amount-integrity snapshot** — the settlement path re-checks provider-reported amounts in minor
  units against the initiation snapshot; mismatches are held, audited and admin-resolved.
- **Soft deletes + audit trail** — every destructive/state change is reversible or recorded.
- **Fail-soft side effects** — receipts, emails and notifications run after commit and never 500 a
  payment response; Redis/SMTP outages do not block boot.
- **Webhook placement** — Stripe (raw body, signature-checked) and SSLCommerz notify routes are
  mounted before body parsers and the general rate limiter; unknown events are acked without state
  change.
- **Money-blind managers** — Property Managers never see payment ledgers and never reach refund /
  lease-termination code.
- **Verified actors before money** — tenants must be identity-`APPROVED` to pay; owners must be
  `APPROVED` to list.
- **Rate limiting + security headers** — helmet, locked-down CORS, general and auth-specific
  `express-rate-limit`.

---

## 📡 API Reference

All routes live under **`/api/v1`** and are grouped per module. Body validation errors return
`400` with `errors: [{ field, message }]`; every success returns
`{ success, message, data, meta? }`. **The authoritative, runnable reference is the bundled
[Postman collection](#postman-collection).**

```
# Auth — register (TENANT/OWNER/PROPERTY_MANAGER), verify-email, login, logout,
#         refresh-token, google, forgot-password, reset-password | GET me
POST   /auth/register            POST  /auth/verify-email            POST /auth/login
GET    /auth/me                  POST  /auth/refresh-token           POST /auth/logout
POST   /auth/google              POST  /auth/forgot-password         POST /auth/reset-password

# User
PATCH  /user/profile-image       PATCH /user/update-me

# Tenant
GET    /tenant/me                PATCH /tenant/update-me             PATCH /tenant/verification-document

# Owner
GET    /owner/me                 PATCH /owner/update-me
POST   /owner/verification-documents     DELETE /owner/verification-documents
POST   /owner/request-verification       PATCH  /owner/verify        # ADMIN
GET    /owner/all-owners                                              # ADMIN

# Property (OWNER creates; OWNER/PM operate on theirs)
POST   /property                          GET /property/my-properties   GET /property/all
GET    /property/public                   GET /property/:propertyId
PATCH  /property/:propertyId              DELETE /property/:propertyId
POST   /property/:propertyId/images       DELETE /property/:propertyId/images
POST   /property/:propertyId/units        PATCH  /property/unit/:unitId  DELETE /property/unit/:unitId
POST   /property/:propertyId/managers     GET    /property/:propertyId/managers
DELETE /property/:propertyId/managers/:managerId

# Room
POST   /room                     GET /room/my-rooms       GET /room/public       GET /room/:roomId
PATCH  /room/:roomId             PATCH /room/:roomId/availability
POST   /room/:roomId/images      DELETE /room/:roomId/images
DELETE /room/:roomId

# Viewing
POST   /viewing                  GET /viewing/my-requests      GET /viewing/owner-requests
POST   /viewing/:requestId/cancel
PATCH  /viewing/:requestId/status

# Roommate — matches, requests/pairs (pre-lease) and memberships (post-lease)
GET    /roommate/match           POST /roommate/request
GET    /roommate/my-requests     PATCH /roommate/request/:requestId/respond
GET    /roommate/my-pairs        DELETE /roommate/pair/:pairId
POST   /roommate/memberships/invite
GET    /roommate/memberships/my
GET    /roommate/memberships/:membershipId/utility-bills
PATCH  /roommate/memberships/:membershipId/respond
POST   /roommate/memberships/:membershipId/leave
POST   /roommate/memberships/:membershipId/remove

# Application
POST   /application/apply        GET /application/my-applications     GET /application/owner-applications
GET    /application/:applicationId
PATCH  /application/:applicationId/review      # approve/reject (capacity-guarded)
POST   /application/:applicationId/pay-deposit # choose gateway: bkash|sslcommerz|stripe
POST   /application/:applicationId/cancel

# Lease
GET    /lease/my-leases          GET /lease/owner-leases
GET    /lease/:leaseId
POST   /lease/:leaseId/terminate               # deposit refund saga (no PROPERTY_MANAGER)
POST   /lease/:leaseId/documents  DELETE /lease/:leaseId/documents/:documentId

# Invoice
GET    /invoice/my-invoices      POST /invoice/utility-bill      GET /invoice/room/:roomId
POST   /invoice/:invoiceId/pay   # choose gateway: bkash|sslcommerz|stripe

# Payment
GET    /payment/gateways                  # public — enabled providers for the UI
GET    /payment/callback                  # bKash redirect (public)
GET    /payment/my-payments               GET /payment/all-payments   GET /payment/:paymentId
POST   /payment/confirm  ·  POST /payment/ipn        # SSLCommerz (public, in app.ts)
POST   /payment/webhook/stripe                          # Stripe (public, in app.ts)

# Maintenance
POST   /maintenance              GET /maintenance/my-requests     GET /maintenance/owner-requests
PATCH  /maintenance/:requestId/status
POST   /maintenance/:requestId/image

# Notification
GET    /notification/my-notifications     GET /notification/unread-count
PATCH  /notification/read-all             PATCH /notification/:notificationId/read

# Manager (delegated operator — assigned properties only)
GET    /manager/me                PATCH /manager/update-me        GET /manager/my-properties

# Admin (ADMIN / SUPER_ADMIN unless noted)
GET    /admin/dashboard-stats     GET /admin/users
PATCH  /admin/users/:userId/status
PATCH  /admin/users/:userId/role              # SUPER_ADMIN only
GET    /admin/audit-logs
GET    /admin/payments/pending-refunds
POST   /admin/payments/pending-refunds/:paymentId/resolve
GET    /admin/payments/pending-settlements
POST   /admin/payments/pending-settlements/:paymentId/resolve
GET    /admin/tenant-verifications PATCH /admin/tenant-verifications/:tenantProfileId

# Analytics (per role)
GET    /analytics/tenant-analytics   GET /analytics/owner-analytics   GET /analytics/manager-analytics

# Meta
GET    /                          # welcome + API banner
GET    /api/v1/health             # health check
GET    /api/cron/daily            # Vercel Cron trigger — runs all daily jobs (CRON_SECRET)
```

Public endpoints (no auth): auth register/login/google/password flows, room & property public
search/detail, and the three payment notify routes above.

---

## ☁️ Deployment

This repo is set up to deploy on **Vercel** as a serverless API. Vercel runs the
Express app from `api/index.ts` (no always-on server), which means a few boot-time
behaviours move elsewhere:

| Local / always-on host (`npm run dev`) | Vercel (serverless) |
| -------------------------------------- | ------------------- |
| `server.ts` boots: seeds + `node-cron` + `app.listen` | `api/index.ts` exports the app; no `listen` |
| Background jobs scheduled in-process (4× daily) | One Vercel Cron hits `GET /api/cron/daily` |
| Seeds run automatically on boot | Run once with `npm run seed` (see below) |
| `localhost` Postgres/Redis | Hosted **Postgres** (Neon) + **Redis** (Upstash) |

### Deploy steps

1. **Host Postgres and Redis** — create a Neon (Postgres) and Upstash (Redis)
   instance; grab both connection strings.
2. **Push the repo to GitHub** and **Import** it in Vercel (Framework Preset:
   *Other*; Node.js ≥ 20). `vercel.json` wires `api/index.ts` as the single
   function and registers the daily cron — no build command needed, `npm install`
   (and its `prisma generate` postinstall) runs automatically.
3. **Set environment variables** in Vercel → Project → Settings → Environment
   (every `.env.example` key), with production values:
   - `DATABASE_URL` = hosted Postgres; `REDIS_*` = Upstash.
   - `BACKEND_URL`, `BACKEND_PUBLIC_URL` = `https://<your-project>.vercel.app`.
   - `BKASH_CALLBACK_URL` = `https://<your-project>.vercel.app/api/v1`.
   - `FRONTEND_URL` = the real frontend domain.
   - `CRON_SECRET` = a strong random value (Vercel Cron authenticates with it).
   - `SUPER_ADMIN_*` / `TESTER_*` = the demo credentials (defaults in `.env.example`).
4. **Apply migrations + seed the hosted DB once** (from your machine, pointing at
   the hosted `DATABASE_URL`):

   ```bash
   npm run prisma:migrate:deploy
   npm run seed
   ```

5. **Deploy.** Open `https://<your-project>.vercel.app/` and
   `/api/v1/health` to confirm.
6. **Provider URLs** — make sure the gateway dashboards point at Vercel:
   - bKash: callback base = `https://<your-project>.vercel.app/api/v1`.
   - SSLCommerz: success/fail/cancel/IPN → `/api/v1/payment/confirm` + `/api/v1/payment/ipn`.
   - Stripe: register webhook `https://<your-project>.vercel.app/api/v1/payment/webhook/stripe`
     for `checkout.session.completed` + `checkout.session.expired`.

> **Serverless notes** — functions are stateless and short-lived: cron is driven
> by Vercel Cron (times are UTC), uploads are in-memory then pushed to
> Cloudinary, PDFs/emails are generated per-request, and all state lives in
> Postgres/Redis. See the bundled *"Node.js TypeScript Project Setup & Vercel
> Deployment Guide.md"* for background on the patterns to avoid.

---

## 📄 Postman Collection

Import **`Housing-Roommate-API.postman_collection.json`** (repo root) for a fully documented,
runnable collection with examples for every role — including multi-gateway payment sessions,
refund/settlement queues and the provider notify routes.

---

## 📝 License & Credits

Built as a **Level-2 (Programming Hero)** assignment. Architecture draws on the PH-Healthcare
reference backend, the Prisma Press multi-gateway payment patterns, and Apollo-Gears-style
project conventions.
