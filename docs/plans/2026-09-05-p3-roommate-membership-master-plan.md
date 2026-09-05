# P3 Master Plan — Post-Lease Roommate Membership (P3-Lite)

Date: 2026-09-05
Status: Approved-for-planning design (not yet implemented)
Parent decision: `2026-09-04-peer-crossmatch-architecture-model.md` §2 (P3 revisit conditions)

---

## 0. Executive summary

P3 adds the one capability the peer project had that we deliberately deferred: a
second person **joining an already-active lease** as a roommate member. We build
it as **P3-Lite** — an *operational presence* with an explicitly closed money
boundary. This is the peer's idea with its three defects fixed:

| Peer defect | Our fix |
|---|---|
| Utility shares split per tenancy, roommate never owes/pays anything coherent | Members **never enter any money flow** — by design, enforced by a zero-edit rule on money files (§4) |
| Membership invisible to occupancy; unbounded growth | Bed/lease counters stay authoritative (membership is not occupancy); **cap: max 1 ACTIVE member per lease**, enforced inside the accept transaction |
| Dead-end role, cosmetic membership | Members get real, bounded capabilities: raise maintenance on the room + view the room's utility bills (trimmed, PII/payment-free) |

**Risk posture.** "Absolutely no chance of error" is physically impossible to
promise; what this plan guarantees instead is **blast-radius containment + full
traceability**:

1. **Additive-first**: 4 new files + 1 migration pair; only **3 annotated edits**
   inside existing code, each a pure OR-branch or an in-transaction cascade.
2. **Zero money-path edits**: `payment.*`, `invoice` write paths, bKash lib,
   refund saga, cron invoice generator are untouched. Invariant enforced by the
   change manifest (§5) and verified in review.
3. **Every mutation is a guarded conditional write + an atomic audit row** — any
   failure is traceable to endpoint → actor → before/after state (§7).
4. **Rollback is trivial**: additive schema + additive endpoints; reverting the
   commits restores the previous behavior exactly (§9).

---

## 1. Goals and non-goals

### Goals
1. A lease-holding TENANT can **invite** a verified tenant to share their leased
   room as a roommate member; the invitee accepts or declines.
2. Either party can end the arrangement (**leave**); the holder, owner, assigned
   manager or admin can **remove** (safety valve for the property side).
3. ACTIVE members can: raise **maintenance** on that room, and **view the room's
   utility bills** (trimmed projection).
4. Lease termination (manual saga + cron completion) **cascades** membership
   closure in the same transaction — no orphaned memberships, ever.
5. Every transition: guarded write, audit log, in-app notification.

### Non-goals (explicit, to protect the hardened core)
- **No money**: members pay nothing, owe nothing, never appear in Payment,
  Invoice (write), cron rent generation, utility splitting, refunds.
- **No occupancy change**: `bedCount`/`occupiedBeds`/`recalculateRoomStatus`
  semantics untouched. Membership is *people*, occupancy is *beds*.
- **No new Role**: members are TENANTs; no auth/registration changes.
- **No emails** for membership events (in-app notifications only; email can be
  layered later without schema change).
- **No discovery/matching changes**: the existing match/pair flow is the natural
  feeder (pair partner gets invited); stranger "apply to join" is out of scope.
- **No analytics/seed changes.**

---

## 2. Concept model

```
RoommatePair (pre-lease, unchanged)          RoommateMembership (P3, post-lease)
match → request → pair ──apply──▶ lease ─────────────────────────┐
                                   │                              │
                                   ▼                              ▼
                            TenantProfile A (holder)      TenantProfile B (member)
                            holds the Lease (1 bed)       joins via membership (cap 1)
```

- **Holder**: the TENANT whose `Lease` it is (`lease.tenantProfileId`).
- **Member**: an invited TENANT with an `ACTIVE` membership on that lease.
- **Trust**: invitee must be identity-**VERIFIED** (same gate as payments,
  spec 03/15). The holder is already verified de facto (they paid a deposit).
- **Owner awareness**: owner is notified when a membership becomes ACTIVE and
  when it ends, and can remove it — the owner can never be blindsided.

### State machine (MembershipStatus)

```
                 invite (holder)                 accept (invitee)
   ─────────────▶ PENDING ─────────────────────▶ ACTIVE ──────────┐
                   │  │                             │             │ leave (member|holder)
        decline    │  │ revoke (holder/             │ remove      │ remove (holder|owner|
     (invitee)     │  │ owner/mgr/admin)            │ (…)         │       mgr/admin)
                   ▼  ▼                             ▼             ▼
                REJECTED                          REMOVED ◀── lease TERMINATED/COMPLETED
                (terminal)                        (terminal)     (cascade, actor recorded)
```

Re-invite after a terminal state (REJECTED/REMOVED) **re-arms the same row**
(upsert reset to PENDING) — the `@@unique([leaseId, tenantProfileId])` stays
valid and history is preserved in the audit log, not in duplicated rows.

---

## 3. Architecture

### 3.1 Containment rings

```
┌────────────────────────────────────────────────────────────────────────┐
│  RING 3 — UNTOUCHABLE CORE (zero edits, verified in review)            │
│  payment.module · bKash lib · invoice writes · refund saga ·           │
│  rent-invoice cron · room counters · auth/registration · lease create  │
└────────────────────────────────────────────────────────────────────────┘
              ▲                                    ▲
   read-only  │ (trimmed select)                   │ (cascade close, in-tx)
┌─────────────┴──────────────────┐   ┌─────────────┴──────────────────────┐
│  RING 2 — INTEGRATION POINTS   │   │  maintenance eligibility OR-branch │
│  (3 annotated edits)           │   │  (lease.service, cron.ts,          │
│  roommate/membership reads     │   │   maintenance.service)             │
│  Invoice table                 │   │                                    │
└─────────────┬──────────────────┘   └─────────────┬──────────────────────┘
              │                                    │
┌─────────────┴────────────────────────────────────┴──────────────────────┐
│  RING 1 — NEW MEMBERSHIP SUBSYSTEM (all additive)                       │
│  prisma/schema/membership.prisma · 2 migrations · roommate module        │
│  functions (invite/respond/leave/remove/lists/bills) · routes · zod     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Data model

`prisma/schema/enums.prisma`:
```prisma
enum MembershipStatus { PENDING ACTIVE REJECTED REMOVED }
```
`NotificationType` gains `ROOMMATE` (additive value; membership events only —
existing pair notifications are left untouched).

`prisma/schema/membership.prisma` (new):
```prisma
model RoommateMembership {
  id             String           @id @default(uuid())
  status         MembershipStatus @default(PENDING)
  message        String?          // invitation note from the holder
  respondedAt    DateTime?
  joinedAt       DateTime?
  removedAt      DateTime?
  removedBy      String?          // User id of whoever ended it
  removalReason  String?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  leaseId         String        @unique   // see note: 1 row max per (lease,tenant)
  lease           Lease         @relation(fields: [leaseId], references: [id], onDelete: Cascade, onUpdate: Cascade)
  tenantProfileId String
  tenantProfile   TenantProfile @relation(fields: [tenantProfileId], references: [id], onDelete: Cascade, onUpdate: Cascade)

  @@unique([leaseId, tenantProfileId], name: "unique_membership_per_lease")
  @@index([tenantProfileId], name: "idx_membership_tenant")
  @@index([status], name: "idx_membership_status")
  @@map("roommate_memberships")
}
```
Relation fields added (additive, both one line): `Lease.memberships
RoommateMembership[]` (lease.prisma), `TenantProfile.memberships
RoommateMembership[]` (tenant.prisma). No soft delete — lifecycle is
status-driven and every transition is audited (matches the `PropertyManager`
join precedent).

**Migrations (two, on purpose):**
1. `<ts1>_add_roommate_notification_type` → `ALTER TYPE "NotificationType" ADD VALUE 'ROOMMATE';`
   (kept alone: Postgres forbids *using* a new enum value inside the same
   transaction that creates it — splitting removes the whole class of failure)
2. `<ts2>_add_roommate_membership` → `CREATE TYPE "MembershipStatus"`, `CREATE TABLE "roommate_memberships"`, indexes, FKs.

### 3.3 Capability matrix (who can do what)

| Action | Holder | Member | Owner | Assigned manager | Admin |
|---|---|---|---|---|---|
| Invite (PENDING) | ✔ (own ACTIVE lease) | — | — | — | — |
| Accept / Decline | — | ✔ (invitee, PENDING) | — | — | — |
| Leave (ACTIVE→REMOVED) | ✔ | ✔ | — | — | — |
| Remove (PENDING or ACTIVE) | ✔ | — | ✔ | ✔ (OPERATE) | ✔ |
| View own memberships | ✔ (sent) | ✔ (received) | — (via notifications) | — | — |
| Raise maintenance on room | ✔ (lease) | ✔ (ACTIVE membership) | — | — | — |
| View room utility bills | ✔ (via lease) | ✔ (trimmed, via membership) | ✔ (existing route) | ✔ (existing route) | ✔ |

Guards enforced *before* any write (fail-fast order, each with a distinct
message — see §7 traceability):
1. Invite: holder owns an ACTIVE lease (`leaseId` param); invitee exists, is a
   TENANT, **VERIFIED**, not the holder; no live (PENDING/ACTIVE) membership on
   that lease; invitee holds no ACTIVE lease on the same room; cap not reached
   (count ACTIVE < 1).
2. Accept: caller is invitee; status PENDING; cap re-checked **inside the
   transaction** (conditional `updateMany` keyed on `status: PENDING` + prior
   ACTIVE count in the same tx — a racing second accept on another invitee
   loses and gets 409).
3. Decline/Leave/Remove: participant/status/authority checks as the matrix;
   removal reason optional (max 300).

### 3.4 Endpoints (all under existing `/api/v1/roommate` mount — app.ts untouched)

| Method | Path | Guard | Success |
|---|---|---|---|
| POST | `/roommate/memberships/invite` | auth(TENANT) + zod | 201 `"Roommate invitation sent successfully"` |
| GET | `/roommate/memberships/my` | auth(TENANT) | 200 `"Memberships fetched successfully"` (meta; optional `status`) |
| PATCH | `/roommate/memberships/:membershipId/respond` | auth(TENANT) + zod | 200 `"Membership responded successfully"` (ACCEPT→ACTIVE / DECLINE→REJECTED) |
| POST | `/roommate/memberships/:membershipId/leave` | auth(TENANT) | 200 `"Membership ended successfully"` |
| POST | `/roommate/memberships/:membershipId/remove` | auth(TENANT, OWNER, PROPERTY_MANAGER, ADMIN, SUPER_ADMIN) + zod | 200 `"Membership removed successfully"` |
| GET | `/roommate/memberships/:membershipId/utility-bills` | auth(TENANT) | 200 `"Room utility bills fetched successfully"` |

`utility-bills` returns **only** `{ id, periodStart, periodEnd, dueDate, amount,
status }` for UTILITY invoices of the membership's room — no `payment`, no
tenant PII, no lease economics. Callers: the member (ACTIVE) or the holder.

### 3.5 Integration points (the only 3 edits to existing code)

**IP-1 — `src/app/module/maintenance/maintenance.service.ts` →
`createMaintenanceRequest`** (eligibility OR-branch):
current lookup requires an ACTIVE lease held by the caller on `payload.roomId`.
Add: if none found, look for an `ACTIVE` membership on an `ACTIVE`,
non-deleted lease of that room; if found, use that lease for `leaseId`.
Existing lease-holder behavior byte-identical; same 403 message when neither.

**IP-2 — `src/app/module/lease/lease.service.ts` → `terminateLease`**
(inside the guarded transaction at the `LEASE_TERMINATED` block, L≈366-419):
after the lease flips to TERMINATED (same tx), close live memberships:
```ts
await tx.roommateMembership.updateMany({
  where: { leaseId, status: { in: [PENDING, ACTIVE] } },
  data: { status: REMOVED, removedAt: now, removedBy: user.userId,
          removalReason: "Lease terminated" },
});
```
plus one `MEMBERSHIP_REMOVED` audit row per closed membership (same tx) and a
fail-soft notification to each member after commit. Cap 1 means this is 0–1
rows in practice.

**IP-3 — `src/app/lib/cron.ts` → `finalizeExpiredLeases` (L118)**: same
closure with `removedBy: "system-cron"`, `removalReason: "Lease completed"`,
audit actor `SYSTEM`, idempotent by construction (statuses are terminal).

No other existing file changes behavior. `recalculateRoomStatus` is **not**
called anywhere new.

### 3.6 Notifications & audit actions

| Event | Notified (type ROOMMATE) | Audit action (atomic, in-tx) |
|---|---|---|
| Invite | invitee "Roommate invitation 🏠" | `MEMBERSHIP_INVITED` |
| Accept | holder + **owner** "Roommate joined 🎉" | `MEMBERSHIP_ACCEPTED` |
| Decline | holder | `MEMBERSHIP_DECLINED` |
| Leave | other party + owner | `MEMBERSHIP_REMOVED` (reason "left") |
| Remove | other party + owner | `MEMBERSHIP_REMOVED` (reason, actor) |
| Lease end (IP-2/IP-3) | member (+ owner on terminate) | `MEMBERSHIP_REMOVED` (actor = terminator/SYSTEM) |

All audit rows carry `entity: "RoommateMembership"`, `entityId`, full actor
identity and `before/after` status — the "exactly where and why" requirement.

---

## 4. Invariants (enforced, not assumed)

1. **I1 Money isolation**: no membership code writes Payment/Invoice; the only
   Invoice touch is a read-only trimmed select. `payment.service.ts`,
   `bKash.ts`, invoice writes, refund saga, rent cron: **zero diffs**.
2. **I2 Occupancy authority**: membership never mutates room counters or
   status; a lease still frees exactly one bed regardless of members.
3. **I3 Single active member**: `@@unique` prevents row duplication; the cap
   check + conditional accept write prevents two ACTIVE rows on one lease.
4. **I4 No orphans**: every path that ends a lease (terminate saga, cron)
   closes memberships in the same transaction.
5. **I5 Trust**: only VERIFIED tenants can become members.
6. **I6 Traceability**: no membership row ever changes status without a
   matching audit row committed atomically.

---

## 5. Change manifest (exact files)

**New (7)**
| File | Purpose |
|---|---|
| `prisma/schema/membership.prisma` | `RoommateMembership` model |
| `prisma/migrations/<ts1>_add_roommate_notification_type/` | enum value |
| `prisma/migrations/<ts2>_add_roommate_membership/` | enum + table + indexes |
| `docs/plans/2026-09-05-p3-roommate-membership-master-plan.md` | this document |
| (within roommate module — new content, existing files) | see below |

**Modified — additive content in existing files (roommate module)**
- `roommate.interface.ts`: `IInviteMembershipPayload`, `IRespondMembershipPayload`, `IRemoveMembershipPayload`
- `roommate.validation.ts`: `InviteMembershipZodSchema` (`leaseId` required, `tenantEmail` email, `message` ≤500), `RespondMembershipZodSchema` (`action` ACCEPT\|DECLINE), `RemoveMembershipZodSchema` (`reason` ≤300, optional)
- `roommate.service.ts`: `inviteMember`, `getMyMemberships`, `respondToMembership`, `leaveMembership`, `removeMembership`, `getMembershipUtilityBills` + private `closeMembershipsForLease(tx, leaseId, actor, reason)` helper (reused by nothing else yet — IP-2/IP-3 inline their own tx versions to keep cross-module coupling at zero)
- `roommate.controller.ts` / `roommate.route.ts`: 6 handlers/routes

**Modified — the 3 integration edits**
- `maintenance.service.ts` — IP-1
- `lease.service.ts` — IP-2 (inside existing guarded tx)
- `cron.ts` — IP-3 (inside existing finalize tx)

**Modified — schema/docs (no runtime behavior)**
- `enums.prisma`, `lease.prisma`, `tenant.prisma` (relation line)
- Specs `00` (models 19→20, enums, audit actions, layout), `08` (membership endpoints/state machine/guards), `10` (termination cascade), `13` (member eligibility); `AGENTS.md` one line.

**Explicitly untouched**: `app.ts`, `payment/*`, `invoice/*` (module), `bKash.ts`,
`propertyAccess.ts`, auth, user, owner, property, room, viewing, application,
notification, admin, analytics, seed, `.env*`.

---

## 6. Risk register

| # | Risk | Likelihood | Mitigation | Residual |
|---|---|---|---|---|
| R1 | Double-accept race (two invitees, cap 1) | Low | Conditional `updateMany` keyed on PENDING + cap count inside same tx; loser gets 409 | None |
| R2 | Orphaned membership on lease end | Med (if forgotten) | IP-2/IP-3 in-transaction cascade; smoke test both paths | None |
| R3 | Member sees money/PII | Low | Dedicated trimmed endpoint; invoice module untouched; bill select enumerated field-by-field | None |
| R4 | Unbounded members (peer's bug) | — | Cap 1 + unique constraint | None |
| R5 | Re-invite blocked by unique | Certain if unhandled | Upsert-reset of terminal rows (§2) | None |
| R6 | Enum ADD VALUE in txn (PG) | Low | Split migrations (ts1/ts2) | None |
| R7 | Side-effect noise fails a committed transition | Low | Notifications strictly after commit, try/catch (codebase pattern) | Row committed, notification retried manually |
| R8 | Maintenance eligibility regression for holders | Low | IP-1 is a pure OR-branch; existing happy path smoke-tested first | None |
| R9 | Cron idempotency break | Low | Closure targets terminal transition only; re-run finds nothing | None |

---

## 7. Error traceability matrix

Every failure has one distinct message; every success has one audit row.

| Endpoint | Failure → code/message | Success audit |
|---|---|---|
| invite | 404 `"Lease not found"` / 403 `"You can only invite roommates to your own active lease"` / 404 `"Tenant not found"` / 403 `"Invited tenant is not verified yet"` / 400 `"You cannot invite yourself"` / 409 `"This tenant already has a live membership on this lease"` / 409 `"This room already has an active roommate member"` / 409 `"Invited tenant already holds an active lease on this room"` | `MEMBERSHIP_INVITED` |
| respond | 404 `"Membership not found"` / 403 `"Only the invited tenant can respond"` / 409 `"Membership has already been ${status}"` / 409 `"This room already has an active roommate member"` | `MEMBERSHIP_ACCEPTED` / `MEMBERSHIP_DECLINED` |
| leave | 404 / 403 `"Only membership participants can end it"` / 409 | `MEMBERSHIP_REMOVED` |
| remove | 404 / 403 `"You are not allowed to remove this membership"` / 409 | `MEMBERSHIP_REMOVED` |
| utility-bills | 404 / 403 `"You are not allowed to view these bills"` | — (read) |
| (lease terminate / cron) | — | `MEMBERSHIP_REMOVED` ×N |

Diagnostic path when something looks wrong: `audit_logs` (action + actor +
before/after + entityId) → `roommate_memberships` row (status + removedBy +
removalReason) → the endpoint's distinct error message. Three hops, always.

---

## 8. Verification plan (no test suite → scripted smoke matrix)

Run against `npm run dev` with seeded accounts; `curl`-level, in order:

1. **Baseline (before any P3 code)**: holder raises maintenance (200), tenant
   invoice list, lease terminate smoke — prove no regression surface.
2. Invite happy path → 201, PENDING, invitee notified, audit row exists.
3. Guards: self-invite 400; unverified invitee 403; duplicate live 409; cap
   occupied 409; invitee-with-lease-on-room 409; non-holder invite 403.
4. Accept → ACTIVE; second invitee accept → 409; owner notified; audit.
5. Decline path → REJECTED; **re-invite same tenant → resets to PENDING** (201).
6. Leave → REMOVED; holder remove → REMOVED; owner remove; manager remove;
   unassigned manager → 403.
7. Member raises maintenance on the room → 201 (leaseId = holder's lease);
   non-member stranger → 403; holder still 201 (IP-1 regression check).
8. `utility-bills` as member → 200, payload contains **no** `payment`/PII keys;
   as stranger → 403; after REMOVED → 403.
9. Terminate the lease → membership REMOVED with `removedBy` = terminator,
   audit + member notification; cron path verified by code review + a
   forced-dated lease in dev DB.
10. `npm run lint:check` / `format:check` / `build` green after every commit.

---

## 9. Rollout & rollback

**Commits (each independently green and smoke-verified):**
1. `feat(membership): schema + migrations for roommate membership` (Ring 1 data)
2. `feat(membership): invitation lifecycle endpoints and guards` (Ring 1 API)
3. `feat(membership): lease-end cascade, member maintenance and bill views` (Ring 2 = IP-1..3)
4. `docs(membership): specs and AGENTS alignment`

**Rollback**: revert commits 3→1; drop `roommate_memberships` +
`MembershipStatus` if desired (the `ROOMMATE` enum value is harmless to keep).
No existing table's data is ever modified by P3 — rollback cannot lose anything.

---

## 10. Open decisions (defaults chosen, flag to override)

| Decision | Default | Alternative |
|---|---|---|
| Initiation direction | Holder **invites** (mirrors proven `managerEmail` pattern; zero PII discovery) | Stranger request flow (needs lease discovery — deferred) |
| Owner consent | Not required; owner **notified on ACTIVE + removal** and may remove | Dual approval (doubles workflow; rejected) |
| Member cap | 1 ACTIVE per lease (constant `MAX_ACTIVE_MEMBERS_PER_LEASE`) | Configurable per room (YAGNI) |
| Member verification | Required (VERIFIED) | PENDING allowed (rejected — trust posture) |
| Emails | None for membership events | Add later, no schema impact |
