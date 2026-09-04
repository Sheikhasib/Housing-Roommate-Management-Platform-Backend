# Target Architecture Model — Peer Cross-match (P1/P2/P4)

Date: 2026-09-04
Status: Decision record / architecture model (not yet implemented)
Scope: Improvements adopted after cross-matching against `C:\Projects\Level-2\housing-platform`

## 1. Context

Two independent, complete implementations of the same assignment exist. Ours
(`Housing-Roommate-Management-Platform-Backend`) follows the `.opencode/specs`
literally: 4 roles (SUPER_ADMIN/ADMIN/OWNER/TENANT), Lease / Invoice / Payment
(bKash) / Notification modules, verified-owner gate, cron jobs, PDF receipts.
The peer repo deviated to a 5-role model (adds PROPERTY_MANAGER and a separate
ROOMMATE actor) with Tenancy / RentPayment / UtilityBill modules.

Cross-match conclusion: our project is ahead on payments, refunds, notifications,
cron, caching, verification of owners, audit richness, and consistency. The peer
repo is ahead on exactly one substantive capability — **property-level delegation
(PROPERTY_MANAGER)** — and has a tenant/roommate identity-verification surface we
lack. We adopt those; we do **not** import the peer's weaknesses (no owner gate,
lazy rent invoicing, unenforced deposit, unused Notification/Document models,
schema-only refunds).

## 2. Scope decision

Success bar: **be clearly ahead of the peer project.**

- **P1 — Property Manager role & property-level delegation.** Adopted.
- **P2 — Tenant identity verification.** Adopted (mirror of our owner pattern).
- **P4 — Platform hygiene.** Adopted, trimmed (multer limits, Redis cache for
  public property search, optional lat/long storage for map pins only).
- **P3 — Post-lease roommate membership (peer's ROOMMATE actor).** **Descoped.**
  Rationale: the peer's own implementation is half-baked (utility shares split per
  tenancy not per roommate; membership invisible to occupancy; roommate never pays
  rent). Revisit only if we are willing to design a correct financial model (rent
  & utility share per member) — this needs a dedicated design pass and is not
  required to stay ahead.

## 3. Actors & data model changes

### 3.1 Role enum

```
Role: SUPER_ADMIN, ADMIN, OWNER, PROPERTY_MANAGER, TENANT
```

No separate ROOMMATE role. Roommate matching stays a TENANT concern (existing
RoommatePair flow). PROPERTY_MANAGER is a first-class account holder but only
ever operates **within properties an APPROVED OWNER assigns them to**.

### 3.2 New Prisma models (`prisma/schema/manager.prisma`)

```
model ManagerProfile {
  id            String   @id @default(uuid())
  name          String
  email         String   @unique
  contactNumber String?
  bio           String?
  isDeleted Boolean   @default(false)
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  userId String @unique
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  assignments PropertyManager[]
}

model PropertyManager {
  id         String   @id @default(uuid())
  assignedAt DateTime @default(now())
  propertyId String
  property   Property @relation(...)
  managerId  String
  manager    ManagerProfile @relation(...)
  @@unique([propertyId, managerId])
  @@index([managerId])
  @@map("property_managers")
}
```

`Property` gains `managers PropertyManager[]`. `User` gains `managerProfile ManagerProfile?`.
`User.role` values stay mutually exclusive with the 1:1 profile rule already used
for tenant/owner. Profile auto-created on register (`PROPERTY_MANAGER`) and on
SUPER_ADMIN role change, matching existing auth/admin behavior.

### 3.3 Verification enum unification

Rename `OwnerVerificationStatus` → `VerificationStatus` (values unchanged:
PENDING / APPROVED / REJECTED). Used by `OwnerProfile` and (new) `TenantProfile`.

```
TenantProfile gains:
  verificationStatus  VerificationStatus @default(PENDING)
  verificationDocUrl  String?
  verificationDocPublicId String?
  rejectionReason     String?
  reviewedBy          String?   // User id
  reviewedAt          DateTime?
```

Doc image is stored via Cloudinary (new folder `verification-docs`) exactly like
owner verification documents. Rejection clears on re-submit (PENDING again), same
semantics as owner `/request-verification`.

## 4. Authorization architecture — capability tiers

Today authorization = coarse role guard + inline `ownerId = ...` scoping in each
service. P1 promotes this into a shared **property access capability layer**.
Manager authorization is membership-based (assigned to a property), not
ownership-based.

New shared util `src/app/utils/propertyAccess.ts`:

```
resolvePropertyRole(user, propertyId, tx?)        -> "OWNER" | "MANAGER" | null
assertPropertyAccess(user, { propertyId }, tx?)   // throws 403 unless OWNER/MANAGER
assertControl(user, { propertyId }, tx?)          // throws 403 unless OWNER (or ADMIN/SUPER_ADMIN)
propertyScopeFilter(user)                          // Prisma where for list endpoints:
   OWNER  -> { ownerId: <ownerProfileId> }
   MANAGER-> { managers: { some: { manager: { userId } } } }
   ADMIN/SUPER_ADMIN -> {}  (admin lists stay on admin module)
```

`tx?` makes checks safe inside `prisma.$transaction`. ADMIN/SUPER_ADMIN retain a
CONTROL override via existing routes; the util centralizes the owner/manager
decision so per-module services stop hand-writing `ownerId`.

### Tier matrix (per endpoint family)

| Operation | OWNER | MANAGER | ADMIN/SUPER_ADMIN |
|---|---|---|---|
| Viewing: respond/status, owner list | yes | yes (scoped) | yes |
| Application: review, owner list | yes | yes (scoped) | — (admin uses admin module) |
| Maintenance: status, owner list | yes | yes (scoped) | yes |
| Room: update/availability/publish | yes | yes (scoped, same rules) | — |
| Property: update fields/images | yes | yes (scoped) | — |
| Invoice: utility-bill create, room list | yes | yes (scoped) | — |
| Lease: view detail/list | yes | yes (scoped, view-only) | yes |
| Analytics: dashboard | owner-stats | manager-stats (non-monetary) | admin |
| Property/room **create/delete**, units create | yes | **no** | owner-delete override only |
| **Lease terminate / deposit refund** | yes | **no** | yes |
| Payment ledger visibility | via admin | **no** | yes |
| Assign/remove managers | yes | **no** | — |

Money isolation is strict: MANAGER never triggers or sees bKash flows, never
terminates leases or refunds, never deletes property/room. Manager actions that
mutate state are audit-logged with `actorRole = PROPERTY_MANAGER` and the acting
`propertyId` when relevant.

## 5. Endpoint surface (new/changed)

New module `src/app/module/manager/` (own profile + preferences only):

- `GET  /manager/me` — own profile + user
- `PATCH /manager/update-me` — contact/bio
- `GET  /manager/my-properties` — assigned properties (via `propertyScopeFilter`)

Manager analytics live in the analytics module as `GET /api/v1/analytics/manager-analytics` (scoped, non-monetary).

Owner-side manager administration (in `property` module, OWNER/CONTROL only):

- `POST   /property/:propertyId/managers` `{ managerEmail }` — assign (validates
  ACTIVE PROPERTY_MANAGER, not soft-deleted, not already assigned) → notify manager
- `GET    /property/:propertyId/managers` — list assigned
- `DELETE /property/:propertyId/managers/:managerId` — revoke → notify manager

Existing owner list routes in viewing/application/maintenance/lease/invoice/room
gain PROPERTY_MANAGER role + `propertyScopeFilter`. Room `PATCH /:roomId`,
`PATCH /:roomId/availability`, property `PATCH /:propertyId` gain PROPERTY_MANAGER
guarded by `assertPropertyAccess` + the exact same validation rules as owners
(bedCount cannot shrink below occupied, cannot mark AVAILABLE while fully leased,
etc.) — no new powers, only delegation of existing rules.

Tenant verification (P2):

- `PATCH /tenant/verification-document` (TENANT, `upload.single("document")`) →
  sets doc fields, resets to PENDING
- `GET  /admin/tenant-verifications` (ADMIN/SUPER_ADMIN) — PENDING with doc set
- `PATCH /admin/tenant-verifications/:tenantProfileId` (ADMIN/SUPER_ADMIN) —
  APPROVED/REJECTED (rejection requires reason) → audit + email + notification

Enforcement: **payment sessions are gated on VERIFIED** in
`application.service.ts pay-deposit` and `invoice.service.ts pay`; browsing,
viewing, roommate matching, and applying remain open (funnel-first). New email
templates: `tenant-account-approved`, `tenant-account-rejected`.

## 6. Migration & data rules

- Prisma enum rename `OwnerVerificationStatus`→`VerificationStatus` is a single
  SQL `ALTER TYPE ... RENAME`; update generated imports across owner/auth/admin
  modules. Mechanical, but done in P2's own migration so P1 is reviewable alone.
- Manager endpoints never bypass `auth(...)`; every state-changing manager action
  writes an audit log.
- All list endpoints keep pagination + `IQuery` + `meta` and `select`/`include`
  narrowing — no regressions.

## 7. Phasing & sequencing

1. **P1** (schema + migration: ManagerProfile, PropertyManager, Role value;
   propertyAccess util; manager module; property manager admin endpoints; extend
   existing owner lists/routes; manager analytics; audit+notification; specs for
   manager + property + affected modules). Largest diff; land first, self-contained.
2. **P2** (enum rename migration; tenant profile fields; tenant doc upload; admin
   review endpoints; gating at payment; email templates; specs 03 + 15 + 00).
3. **P4** (multer size/MIME limits; Redis cache for `GET /property/public`; add
   optional lat/lng columns to Property surfaced in payloads — display only, no
   geo search; spec 05 + 00 notes).
4. **P3** stays descoped unless a dedicated financial-model design is approved.

Explicitly excluded from every phase: adopting peer's unenforced-deposit,
lazy-invoicing, no-owner-gate, or unused-model behavior.

## 8. Success criteria

- `npm run dev` boots; seed adds a demo PROPERTY_MANAGER account
  (`manager@housing.com`), tenant demo already VERIFIED so flows keep working.
- Manager assigned to the seed owner's property can respond to a viewing and
  review an application; cannot terminate a lease, refund, or create/delete a
  property.
- Unassigned manager gets 403; owner sees only own managers.
- Unverified tenant gets 403 on `pay-deposit` and invoice `pay`; VERIFIED tenant
  succeeds.
- Audit logs carry manager actor for manager actions.
- `npm run lint:check`, `format:check`, `build` pass; Postman/Thunder Client
  smoke tests per changed route.

## 9. Follow-ups

- Update `.opencode/specs/00` (roles, enums, layout, conventions), `03` (tenant
  verification), `05`/`06` (manager assignment + room delegation), `15` (admin
  tenant verification), `16` (manager analytics), and add manager spec coverage in
  `07`/`09`/`13`/`11` route tables.
- Before P1 implementation: full implementation plan (per module) + spec edits.
