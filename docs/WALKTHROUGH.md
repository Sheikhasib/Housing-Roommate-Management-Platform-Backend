# Housing & Roommate Management Platform — Full Walkthrough

A start-to-finish guide to the backend: what the platform is, how the data flows,
and exactly **in what order** to exercise every feature (via the bundled Postman
collection or `curl`) — from boot to billing to admin.

> Target reader: someone who knows *what* the platform does but wants to know
> *how* the requests must be sequenced and why.

---

## 1. The Big Picture

Five actors operate one room-renting lifecycle:

```
Owner lists a room  →  Tenant finds & applies  →  Owner approves
      →  Tenant pays deposit (bKash / SSLCommerz / Stripe)
      →  Lease is created automatically  →  Monthly rent invoices + utility bills
      →  Roommates can join the lease  →  Maintenance is tracked  →  Admin audits all of it
```

Two hard rules make every flow safe:

- **Occupancy = beds.** A room has `bedCount`/`occupiedBeds`. Only a **paid booking
  deposit** consumes a bed by creating an ACTIVE lease. Post-lease *roommates* are
  people sharing that lease — they never consume a bed and never touch money.
- **Money only moves through a gateway.** A payment is never marked `PAID` by hand.
  It becomes `PAID` only after the gateway (bKash execute, SSLCommerz validator,
  Stripe signed webhook) verifies it, and the amount is cross-checked against the
  snapshot taken when the session was created.

---

## 2. Concepts You Must Know First

| Concept | Meaning |
| --- | --- |
| **Role** | `SUPER_ADMIN` / `ADMIN` / `OWNER` / `PROPERTY_MANAGER` / `TENANT`. Registration allows OWNER, TENANT, PROPERTY_MANAGER; admins are seeded or role-changed. |
| **Verification** | A new OWNER must be admin-`APPROVED` before listing. A TENANT must be identity-`APPROVED` before paying anything. Seeded accounts are already approved. |
| **Owner → Manager delegation** | An OWNER assigns a PROPERTY_MANAGER to a specific property. The manager operates that property (rooms, applications, viewings, bills, maintenance) but is **money-blind**: no lease termination, no refunds, no payment ledgers. |
| **Application states** | `PENDING → APPROVED / REJECTED / CANCELLED / EXPIRED` (expired after 14 days by cron). |
| **Payment purpose ↔ subject** | `DEPOSIT` = pays an Application; `RENT`/`UTILITY` = pays an Invoice. One payment row per subject. |
| **Lease** | Born from a settled DEPOSIT on an APPROVED application. `ACTIVE → COMPLETED` (end date passes) or `TERMINATED` (manual, pre-move-in = refund). |
| **Gateway selection** | `gateway: "bkash" | "sslcommerz" | "stripe"` (default bKash). Enabled list = `GET /api/v1/payment/gateways`. |
| **Audit log** | Every approval/status/role/refund/termination writes an append-only `AuditLog` row. |

---

## 3. Before You Touch Postman

### 3.1 Start the backend (local)

```bash
npm install
cp .env.example .env        # fill DATABASE_URL + Redis + SMTP + Cloudinary + gateway keys
npm run prisma:migrate      # apply migrations (dev)
npm run dev                 # seeds demo accounts + starts cron
```

On boot the server auto-seeds **5 demo accounts** and one demo portfolio
(property "Green View Residence", rooms 101 & 102). Confirm with:
`GET http://localhost:5000/api/v1/health`.

> Deployed on Vercel instead? Use `https://housing-roommate-management-platform-backend.vercel.app`
> as your base URL. (OTP email + payments need hosted Redis + gateway URLs there.)

### 3.2 Postman setup (2 variables, that's it)

1. Import **`Housing-Roommate-API.postman_collection.json`**.
2. Open the **Variables** tab of the collection.
3. Set `base_url` → `http://localhost:5000` (or the Vercel URL).
4. `accessToken` stays empty until you log in.

**The token dance (do this every time you switch roles):**
Login request → copy `data.accessToken` from the response → paste into the
`accessToken` variable. All protected requests read it automatically via
`Authorization: Bearer {{accessToken}}`.

### 3.3 Demo accounts

| Role | Email | Password | State |
| --- | --- | --- | --- |
| Super Admin | `superadmin@housing.com` | `Admin@1234` | — |
| Admin | `admin@housing.com` | `Admin@1234` | — |
| Owner | `owner@housing.com` | `Owner@1234` | APPROVED + seeded property/rooms |
| Property Manager | `manager@housing.com` | `Manager@1234` | assigned to the seed property |
| Tenant | `tenant@housing.com` | `Tenant@1234` | VERIFIED (can pay) |

---

## 4. The Golden Path — a Tenant Rents a Room (read this first)

This is the main spine of the whole platform. Each row lists **who** must be logged
in and which Postman request to run. Watch the order — each step depends on the one
above it.

| # | Who | Postman folder → request | You must have / get |
| --- | --- | --- | --- |
| 1 | anyone | **Room** → *Public Rooms* | pick a `roomId` (e.g. seeded Room 102) |
| 2 | Tenant | **Auth** → *Login - Tenant (demo)* | tenant `accessToken` |
| 3 | Tenant | **Application** → *Apply for Room* | body: `roomId`, `moveInDate`, `leaseMonths` → response gives `id` = `applicationId` |
| 4 | Owner | **Auth** → *Login - Owner (demo)* | owner `accessToken` (overwrite!) |
| 5 | Owner | **Application** → *Owner Applications* → *Approve Application* | `applicationId` from step 3 |
| 6 | Tenant | **Auth** → *Login - Tenant (demo)* | tenant token again |
| 7 | Tenant | **Application** → *Pay Booking Deposit* | body may include `gateway`; response returns `paymentUrl` |
| 8 | — | **Complete the payment in a browser** | the gateway page (sandbox) |
| 9 | Tenant | **Lease** → *My Leases* | an ACTIVE lease now exists (deposit settled) |
| 10 | Tenant | **Invoice / Billing** → *My Invoices* | rent invoices appear via the daily cron; owners can post utility bills |
| 11 | Tenant | **Maintenance** → *Create Maintenance Request* | works once an ACTIVE lease exists |

After step 9 the room's bed is consumed and the room status is recalculated.

> **No-gateway alternative:** if you don't have real bKash/SSLCommerz/Stripe
> sandbox keys, stop at step 5. You can still demo every *non-money* feature
> (viewings, roommate requests, maintenance, admin, analytics) using the seeded
> data — just skip payment→lease and use the owner's own rooms to trigger the
> other flows.

---

## 5. Role-by-Role Walkthrough (top to bottom)

### 5.1 PUBLIC — browse without logging in

1. **Room** → *Public Rooms (search/cache)* — search `?city=&maxRent=&type=` (Redis-cached).
2. **Room** → *Room Detail*.
3. **Property** → *Public Properties* / *Property Detail*.
4. **Health** → *Health Check*.

### 5.2 AUTH — accounts, OTP, tokens, password reset

1. **Auth** → *Register Tenant* (or Owner / Manager — role is in the body).
2. Check your email → **Auth** → *Verify Email (OTP)*.
3. **Auth** → *Login - Tenant (demo)* → save `accessToken`.
4. **Auth** → *Get Me* (proves the token works).
5. Optional: *Refresh Token*, *Logout*, *Forgot/Reset Password*, *Google Login*.

> New accounts are NOT verified yet. A Tenant stays unverified until an admin
> approves their identity doc (section 5.8) — unverified = **cannot pay**.
> A new Owner stays unapproved until an admin approves (section 5.3 / 5.8).

### 5.3 OWNER — listing a property, start to finish

Owner profile + admin approval:

1. **Auth** → *Register Owner* + verify email (if using a fresh account).
2. **Owner** → *Upload Verification Documents* (multipart, up to 5 files).
3. (As **ADMIN**) **Owner** → *Verify (Approve/Reject) Owner*.
4. **Owner** → *Get My Owner Profile* → `verificationStatus` should be `APPROVED`.

> The seeded `owner@housing.com` is already approved, so for the demo you can skip
> to step 5.

Build the portfolio (each request needs the id from the previous response):

5. **Property** → *Create Property* → gives `propertyId`.
6. **Property** → *Create Unit (Flat)* → gives `unitId` (units are optional).
7. **Room** → *Create Room* (needs `propertyId` + optional `unitId`; set `bedCount`,
   `monthlyRent`, `bookingDeposit`, `roomType`, `name`).
8. **Room** → *Upload Room Images* / **Property** → *Upload Property Images*.
9. **Room** → *Set Availability / Publish* → room appears in public search.
10. **Property** → *Assign Manager to Property* (optional delegation, section 5.4).

Delegation recap (from the owner's side): assign a manager, list managers,
remove a manager.

### 5.4 PROPERTY MANAGER — the delegated operator

The seeded `manager@housing.com` is already assigned to the seed property.

1. **Manager** → *Get My Manager Profile* / *Update My Manager Profile*.
2. **Manager** → *My Managed Properties* → only assigned properties.
3. Using the **manager token**, run owner-scoped actions **on that property**:
   rooms list/update, viewing status, application review, utility bills,
   maintenance status. Role guards stop a manager from:
   - terminating a lease or touching payments,
   - creating/deleting property/rooms,
   - assigning/removing managers.

### 5.5 TENANT — profile, verification, discovery

1. **Auth** → *Login - Tenant (demo)*.
2. **User Profile** → *Update My Profile*, *Upload Profile Image*.
3. **Tenant** → *Get My Tenant Profile* → **Tenant** → *Upload Verification Document*
   (needed before an admin can approve you for payments).
4. **Tenant** → *Update My Tenant Profile* (set `lookingForRoommate`, budget, city —
   these feed the roommate matcher).
5. **Viewing** → *Request Viewing* on a room → owner approves/cancels.
6. **Roommate** → *Get Roommate Matches (cached)* → *Send Roommate Request* →
   the other tenant *Respond (Accept)* → *My Roommate Pairs*.

Viewings & roommate requests have their own mini state machines:

```
Viewing: PENDING → APPROVED / REJECTED (owner)  | CANCELLED (tenant)
Roommate request: PENDING → ACCEPTED / DECLINED (the other tenant)
```

### 5.6 The money spine — deposit → lease → invoices

This is **section 4, steps 6–10**, and it is the only place occupancy changes.

1. Tenant pays deposit (choose `gateway`; pay on the provider page).
2. Backend verifies + settles → creates the ACTIVE lease → consumes the bed →
   emails a PDF receipt → notifies the owner.
3. **Lease** → *My Leases* / *Owner Leases* / *Lease Detail*.
4. **Lease** → *Upload Lease Document* (multipart agreement).
5. If the lease **hasn't started** and someone wants out:
   **Lease** → *Terminate Lease* → refund saga runs (bKash/Stripe auto-refund,
   SSLCommerz queues a manual refund) → payment `REFUND_PENDING → REFUNDED` →
   lease `TERMINATED` → bed released.
6. **Invoice / Billing** — monthly RENT invoices are generated by the cron (00:10).
   To see one *now*:
   - (Owner) **Invoice / Billing** → *Create Utility Bill* (roomId) — auto-split
     among active roommates.
   - (Tenant) **Invoice / Billing** → *My Invoices* → *Pay Invoice* (gateway again).

> Payment folder notes: `bKash Callback`, `SSLCommerz Confirm/IPN`, and
> `Stripe Webhook` are **provider→server** endpoints. You don't run them by hand
> in a demo — the gateway calls them. They're in the collection so you can see and
> debug the contracts. `My Payments` / `All Payments` / `Payment Detail` are the
> ones a human checks.

### 5.7 ROOMMATES AFTER MOVE-IN — memberships (people, not beds)

Requires an ACTIVE lease (so: section 4 must have completed) **and a second verified
tenant**.

1. Lease-holding Tenant: **Roommate** → *Invite Roommate Member* (the lease-holder's
   active lease + the second tenant's profile).
2. Second Tenant: **Roommate** → *My Memberships* → *Respond to Membership Invite*
   (accept/reject).
3. Either side can **Leave Membership**; owner/admin/tenant can *Remove Membership*.
4. Member sees the shared room's bills: **Roommate** → *Membership Utility Bills*.

The membership is a person's right to share the room — it never changes bed counts
and never writes payments/invoices. When the lease ends/terminates, the membership
closes in the same transaction.

### 5.8 ADMIN — governance and reconciliation

As **ADMIN** (or SUPER_ADMIN), after logging in:

1. **Admin** → *Dashboard Stats* — platform overview.
2. **Admin** → *All Users* → *Block User* (status) / *Change User Role*
   (SUPER_ADMIN only; never promotable to SUPER_ADMIN).
3. Owner approvals live in **Owner** → *Verify (Approve/Reject) Owner*.
4. **Admin** → *Pending Tenant Verifications* → *Review Tenant Verification* →
   a tenant becomes payment-capable.
5. **Admin** → *Audit Logs* — approvals, status/role changes, refunds, cron flags.
6. **Payment queues** (only reachable when money got stuck):
   - *Pending Refund Payments* → *Resolve Pending Refund* (`REFUNDED` or `NOT_REFUNDED`).
   - *Pending Settlement Payments* → *Resolve Pending Settlement* (`SETTLED` or
     `NOT_SETTLED`) — the admin settles sessions whose provider notification was lost.
   The nightly cron only *flags* these; the admin decides.

### 5.9 ANALYTICS — per role

1. **Analytics** → *Tenant Analytics* (Tenant token).
2. **Analytics** → *Owner Analytics* (Owner token).
3. **Analytics** → *Manager Analytics* (Manager token; non-monetary, assigned
   properties only).

### 5.10 NOTIFICATIONS — where events show up

Events (payment success, approvals, lease events, maintenance, memberships) create
notifications for the involved users and often email them. Check with a logged-in
token:

- **Notification** → *My Notifications* → *Unread Count* → *Mark One Read* /
  *Mark All Read*.

---

## 6. What Runs in the Background (you don't call these)

| When | Job | Effect |
| --- | --- | --- |
| Daily 00:10 | rent invoices | RENT invoice per ACTIVE lease from month two (deposit covered month one) |
| Daily 00:15 | lease finalizer | leases past end date → `COMPLETED`; bed released; memberships closed |
| Daily 00:20 | application expiry | `PENDING` applications older than 14 days → `EXPIRED` |
| Daily 00:25 | payment reconciliation | probes `PROCESSING` payments > 24 h; flags ambiguous ones for the admin settle queue (never auto-settles) |
| Vercel only | `GET /api/cron/daily` | runs all four above (guarded by `CRON_SECRET`) |

All are idempotent and also do a catch-up run when a long-running server boots.

---

## 7. Dependency Map (the "why" behind the order)

```
Register ─► Verify email ─► Login (token) ─► Profile / verification docs
                                                        │
Owner APPROVED? ──► Property ─► Unit ─► Room ─► Publish / availability
                                                        │
Tenant VERIFIED? ─► Viewing / Roommate requests  ◄──────┘
                                                        │
                              Application (PENDING)
                                        │ owner approves (capacity guard)
                                        ▼
                              Pay booking deposit (gateway)
                                        │ gateway verifies + amount check
                                        ▼
                                   LEASE CREATED (bed consumed)
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            ▼                           ▼                           ▼
   monthly RENT invoices      utility bills (split)       roommate memberships
            │                                                   │
            ▼                                                   ▼
        Pay Invoice (gateway)                          maintenance requests
            │                                                   │
            ▼                                                   ▼
     receipt + notification                        owner resolves ─► notification
```

---

## 8. Troubleshooting Cheat-Sheet

| Symptom | Cause → fix |
| --- | --- |
| `401` | token missing/expired, or you're on the wrong role's token → re-login + repaste `accessToken` |
| `403 "account is not verified yet..."` (pay) | tenant not identity-`APPROVED` → admin review (5.8) |
| `403` owner actions | owner not `APPROVED` → admin verify owner |
| `403` manager on money routes | **by design** — managers never see/refund payments |
| `409 "already in progress or completed"` | a payment already exists for this application/invoice (or it's PROCESSING) |
| `409 "No bed is available..."` | room full — the capacity guard is doing its job |
| `409 "Application is no longer approved"` | the application was approved then cancelled/expired before payment |
| `400 errors: [{field,message}]` | validation — read the field message (typo'd id, wrong body key) |
| Payment stuck `PROCESSING` | provider notification was lost → nightly cron flags it → admin settle queue (5.8) |
| no rent invoices yet | they generate on the **daily cron**, from month two — or run `GET /api/cron/daily` (Vercel) |

---

## 9. Suggested 10-Minute Demo Script

1. `GET /api/v1/health` → healthy.
2. `GET /api/v1/room/public` → note a `roomId`.
3. Login Tenant → **Apply for Room**.
4. Login Owner → **Approve Application**.
5. Login Tenant → show **My Applications** is APPROVED, then (if gateways configured)
   **Pay Booking Deposit** and complete it in the sandbox browser page.
6. **My Leases** → ACTIVE lease visible.
7. Owner → **Create Utility Bill** on that room → Tenant → **Pay Invoice** → show
   **My Payments** + the receipt email.
8. Tenant → **Create Maintenance Request** → Owner → **Update Maintenance Status**.
9. Admin → **Audit Logs** → show the trail all of the above produced.
10. Manager → **My Managed Properties** → then prove a manager **cannot** call a
    lease-terminate/payment route (403 = correct behaviour).

---

_Generated from the actual routes, services, cron jobs and seed data of the repo —
see `README.md` for the architectural deep-dive._
