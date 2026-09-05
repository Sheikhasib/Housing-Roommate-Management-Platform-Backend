# Master Plan — Multi-Gateway Payments (bKash + SSLCommerz + Stripe)

Date: 2026-09-05
Status: Approved-for-planning (not yet implemented)
Revision 2 (post-review): success-side admin settle queue added (§2.2/§2.4/§4);
M1 column renames eliminated — additive schema only (§2.3); Stripe M3 notes
(event allowlist, event-id idempotency, event-sourced amount) and droppable
framing; SSLCommerz accepted validator tokens pinned. M1 byte-identical bKash
smoke is a **hard merge block** before any M2 work.
Revision 3 (final review): I-G2 unit normalization specified (adapters
normalize to minor units); pre-drop grep for the legacy `paymentGateway`
column added to M1; bKash stale rows probed via idempotent re-execution
(M4, errored probes = ambiguous); optional per-route limiter on notify
routes; `ResolvePendingSettlementZodSchema` + spec-15 route rows noted.
References:
- **SSLCommerz pattern** → `C:\Projects\Level-2\assignment-4\GearUp-API-Backend` (payment module)
- **Stripe pattern** → `C:\Projects\Level-2\prisma-press-backend` (subscription module + app.ts raw-body mounting)

---

## 0. Executive summary

Goal: tenants choose between **bKash** and **SSLCommerz** for BDT payments, and
**Stripe** for international payments. Three buttons on the frontend, one
money-ledger backend.

Non-negotiable constraint from the user: **each gateway is implemented the way
it was implemented in the reference projects** — the *internals* (HTTP calls,
validation, verification, route shapes) are pattern-faithful ports; the
*structure around them* (adapter interface, registry, shared settle logic)
follows this project's conventions so the three ports coexist without
cross-contamination.

Risk posture (same discipline as P1–P3): the payment engine is the most
hardened subsystem in this repo (refund saga, reconciliation queue, guarded
writes, idempotent callbacks). The plan is **phased, zero-behavior-change-first**:
bKash is refactored behind the adapter interface with byte-identical behavior
before any new gateway is added, and every phase ends green
(lint/format/build + live smoke) with its own revertible commits.

**Honest caveat:** with sandbox credentials, live end-to-end Stripe/SSLCommerz
settlement cannot be completed in local smoke tests the way bKash sandbox can
(bKash tokenized sandbox executes payments; SSLCommerz sandbox can be driven
through its hosted page; Stripe test mode can be driven with the Stripe CLI or
test card 4242…). Verification steps per gateway are therefore explicit per
phase (§8).

---

## 1. Reference pattern inventory (what is ported from where)

| Concern | Source project | Source files | Port target |
|---|---|---|---|
| SSLCommerz init (form-urlencoded POST, `store_id`/`store_passwd`, `tran_id`, success/fail/cancel/ipn URLs, `GatewayPageURL`) | GearUp | `src/modules/payment/payment.service.ts` `initiatePayment` | `src/app/lib/sslcommerz.ts` + `payment.service.ts` adapter call |
| SSLCommerz server-side validation (validator API with `val_id` + store creds; `VALID`/`VALIDATED` → PAID, else FAILED) | GearUp | `payment.service.ts` `confirmPayment` | same, inside our adapter + shared settle |
| SSLCommerz routes (POST `/confirm` → frontend redirect, POST `/ipn` → JSON) | GearUp | `payment.route.ts` / `payment.controller.ts` | `/api/v1/payment/confirm`, `/api/v1/payment/ipn` |
| SSLCommerz env vars + sandbox store credentials | GearUp `.env` | `SSL_COMMERZ_STORE_ID/PASSWORD`, `SSLCOMMERZ_INIT_URL/VALIDATE_URL`, `BACKEND_PUBLIC_URL` | our `.env` (values copied; `.env.example` placeholders) |
| Stripe singleton client | Prisma Press | `src/lib/stripe.ts` (`new Stripe(config.stripe_secret_key)`) | `src/app/lib/stripe.ts` |
| Stripe Checkout Session creation (line_items, success/cancel URLs, metadata carrying our ids) | Prisma Press | `subscription.service.ts` `createCheckoutSession` | our adapter `initiate` (one deviation: `mode: "payment"` — see deviation 3 below) |
| Stripe signed webhook (`express.raw` mounted **before** `express.json()`, `stripe-signature` header, `stripe.webhooks.constructEvent`, event switch) | Prisma Press | `app.ts:82`, `subscription.controller.ts` `handleWebhook` | `app.ts` raw mount + `payment.route.ts` `/webhook/stripe` |
| Stripe env vars + test key + webhook secret | Prisma Press `.env` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | our `.env` (values copied; `.env.example` placeholders) |
| Payment row created at initiation with provider ref + raw payload kept (`tranId`, `meta Json`) | GearUp schema | `prisma Payment model` | our Payment row (already exists; add provider refs) |

Deviations (documented, minimal, each with a reason):
1. **GearUp creates the payment row inside initiate**; we already upsert a
   PROCESSING Payment at initiation keyed on `applicationId`/`invoiceId` — we
   keep our stronger model (one live session per subject, duplicate-session 409)
   and add the provider refs to it.
2. **GearUp's confirm flips order CONFIRMED→PAID**; our equivalents are the
   existing idempotent `handleDepositSuccess` / `handleInvoiceSuccess`
   (lease creation + bed occupancy + invoice PAID) — reused by every adapter.
3. **Prisma Press is `mode: "subscription"` with a Stripe Price id**; our
   payments are one-time → `mode: "payment"` with inline `price_data`
   (no pre-created Stripe product needed).
4. **Prisma Press webhook has no auth and no rate-limit exemption**; we mount
   the webhook/IPN/confirm routes **before** the general rate limiter (same
   placement as `/api/v1/health`) — provider retry storms must not eat the
   user-facing 300 req/15min budget.
5. Reference projects answer with raw `res.json`/redirects on notify routes;
   our notify routes follow the references (redirect for `/confirm`, plain JSON
   200 for `/ipn` and the Stripe webhook — Stripe requires a 200 ack, error
   envelope would trigger endless retries), while all *user-facing* endpoints
   keep the `sendResponse` envelope.

---

## 2. Target architecture

### 2.1 Adapter interface + registry (our structure)

```
src/app/lib/payments/
  types.ts          — PaymentGatewayAdapter interface + initiate/verify result types
  registry.ts       — getAdapter(gateway), listEnabledGateways() (env-driven)
  settle.ts         — shared, gateway-agnostic settle/fail helpers
                      (wraps handleDepositSuccess/handleInvoiceSuccess +
                       amount verification + audit rows)
adapters:
  src/app/lib/bKash.ts        (existing file, refactored to implement the interface)
  src/app/lib/sslcommerz.ts   (new, GearUp pattern)
  src/app/lib/stripe.ts       (new singleton) + stripe logic in adapter
```

```ts
interface PaymentGatewayAdapter {
  readonly gateway: PaymentGateway;          // enum value
  isEnabled(): boolean;                      // creds present in env
  initiate(input: {
    paymentId: string;                       // our Payment row id
    purpose: PaymentPurpose;
    amount: Decimal;                         // BDT ledger amount
    description: string;
    payerEmail: string;
  }): Promise<{ redirectUrl: string; providerPaymentId: string; raw: unknown }>;
  verifyAndSettle(input: {                   // the ONLY path that may set PAID
    payment: PaymentRow;                     // found by provider ref
    providerPayload: Record<string, unknown>;
  }): Promise<"SETTLED" | "ALREADY_SETTLED" | "FAILED" | "CANCELLED" | "AMOUNT_MISMATCH">;
  refund?(input: { payment: PaymentRow; amount: Decimal; reason: string }):
    Promise<{ providerRefundId: string | null; raw: unknown }>;
}
```

**Rule:** `payment.service.ts` (the module) owns subject authorization, the
one-live-session guard and the payment row; adapters own provider HTTP;
`settle.ts` owns the money transition + audit. No adapter ever writes a
Payment/Invoice/Lease row directly — they return normalized outcomes to
`settle.ts`. This keeps the hardened money logic in exactly one place.

### 2.2 Route map

| Route | Method | Auth | Notes |
|---|---|---|---|
| `/api/v1/payment/gateways` | GET | public | `{ gateways: ["bkash","sslcommerz","stripe"] }` from enabled adapters (env-driven) — powers the three buttons |
| `/api/v1/payment/callback` | GET | public | **unchanged bKash legacy route** (merchant-portal URL already points here; existing sessions keep working) |
| `/api/v1/payment/confirm` | POST | public | SSLCommerz success/fail/cancel POST (GearUp pattern) → validate → settle → **redirect to frontend** (like both our bKash callback and GearUp's controller) |
| `/api/v1/payment/ipn` | POST | public | SSLCommerz IPN → validate → settle → JSON 200 (GearUp pattern) |
| `/api/v1/payment/webhook/stripe` | POST | public | `express.raw({type:"application/json"})` mounted **before** body parsers (Prisma Press pattern) → `constructEvent` → settle → 200 ack |
| `/api/v1/application/:id/pay-deposit` | POST | TENANT | gains optional body `gateway` (default `bkash`); 400 on unknown/disabled gateway |
| `/api/v1/invoice/:invoiceId/pay` | POST | TENANT | same |
| `/api/v1/admin/payments/pending-settlements` | GET | ADMIN/SUPER_ADMIN | success-side counterpart of the REFUND_PENDING queue: PROCESSING rows whose provider notification was lost (money possibly captured, nothing settled) |
| `/api/v1/admin/payments/pending-settlements/:paymentId/resolve` | POST | ADMIN/SUPER_ADMIN | validateRequest(`ResolvePendingSettlementZodSchema`: `outcome` SETTLED \| NOT_SETTLED, `note` optional — mirrors `ResolvePendingRefundZodSchema`; the GET takes raw query filters only, exactly like the pending-refunds pair); admin verifies the provider's status (Stripe dashboard / SSLCommerz merchant panel / bKash portal), then outcome `SETTLED` runs the guarded settle through the SAME `settle.ts` path (lease/bed/invoice side effects included) or `NOT_SETTLED` downgrades to FAILED so the tenant can retry; `PENDING_SETTLEMENT_RESOLVED` audit + tenant notification — mirrors `resolvePendingRefundPayment` exactly |

`/confirm`, `/ipn`, `/webhook/stripe` are mounted in `app.ts` **before**
`app.use("/api/v1", generalRateLimiter)` (health-route placement). Optionally
each notify route also carries a high-budget per-route limiter
(e.g. 1000 req / 15 min) to blunt raw-request floods without starving
provider retries.

### 2.3 Schema (M1, one migration — **additive only, zero renames**)

```
enum PaymentGateway { BKASH  SSLCOMMERZ  STRIPE }
```
Payment model changes (data-preserving, no column renames — the rename churn
was the plan's own top regression risk and is eliminated):
- **ADD** `gateway PaymentGateway @default(BKASH)` — one-time backfill
  `UPDATE payments SET gateway='BKASH'` (every existing row is bKash), then
  **DROP** the legacy free-text `paymentGateway` column (its data fully lives
  in the new enum column).
- **ADD** `providerChargeCurrency String?` + `providerChargeAmount Int?`
  (minor-units snapshot taken at initiation — the settle-time amount check
  compares against what the provider actually charges/reports).
- **ADD** `@@index([gateway, bKashPaymentId])` — provider-ref lookups are
  gateway-scoped pairs.
- **KEEP** `bKashPaymentId`, `bKashTrxId`, `paidAt`, `gatwayResponse` exactly
  as they are: they are the provider-neutral storage under legacy names (the
  bKash/SSLCommerz/Stripe adapters all read/write these columns; the naming is
  documented inside `lib/payments/types.ts`). The cosmetic renames and the
  `gatwayResponse` typo fix move to an **optional post-M3 cleanup commit** (or
  are skipped — internal field, zero caller impact).
- `merchantInvoiceNumber @unique` remains **THE subject key**
  (`applicationId` / `invoiceId`): one live session per subject regardless of
  gateway; provider ids (`bKashPaymentId` column) are gateway-scoped and
  non-unique — lookups filter on `(gateway, providerPaymentId)`.

The code-reference sweep for M1 is therefore tiny: only the enum column swap
(the default already says bKash everywhere that matters) plus the new snapshot
writes in `settle.ts` — no grep-driven rename sweep across the hardened code.

### 2.4 Money invariants (unchanged + strengthened)

- **I-G1** PAID is set **only** after provider-verified confirmation:
  bKash execute / SSLCommerz validator `VALID|VALIDATED` / Stripe
  `constructEvent` + `checkout.session.completed` (session `payment_status === "paid"`).
- **I-G2** **Amount verification at settle** (new, all gateways): provider-reported
  amount must equal the `providerChargeAmount` snapshot stored at initiation
  (mismatch → stay PROCESSING + `PAYMENT_AMOUNT_MISMATCH` audit for admin;
  never settle a wrong amount). **Units:** the snapshot is Int **minor
  units**; every adapter normalizes the provider-reported amount into that
  scale before comparison (bKash/SSLCommerz report BDT taka strings → ×100;
  Stripe already reports minor units) — otherwise the check is
  unit-inconsistent.
- **I-G3** Idempotency: repeated confirmations/IPNs/webhooks are no-ops
  (existing `alreadyPaid` guards + conditional status writes).
- **I-G4** Failure/cancel paths only ever downgrade non-PAID rows
  (conditional `updateMany where status != PAID` — fixes the out-of-order clobber).
- **I-G5** Cron/reconciliation **never sets PAID automatically**; a definitive
  provider "paid" verdict on a stuck PROCESSING row **routes to the admin
  settle queue** (`/admin/payments/pending-settlements`, §2.2) instead of being
  silently stranded — the success-side mirror of REFUND_PENDING. Ambiguous
  outcomes stay PROCESSING for the same queue.
- **I-G6** Every transition writes an audit row (§4).

### 2.5 Refund dispatch (termination saga)

`lease.service.ts` refund step dispatches on `payment.gateway`:
- **BKASH** → existing saga unchanged (REFUND_PENDING reservation, ambiguous → reconciliation queue).
- **STRIPE** → `stripe.refunds.create` (synchronous, queryable) mapped into the same reservation pattern (PAID→REFUND_PENDING→REFUNDED).
- **SSLCOMMERZ** → out of scope for automated refund (their refund API is a managed transaction API); termination of an SSLCommerz-paid deposit returns a clear 409-style guidance + the payment is marked for the existing admin reconciliation flow. Documented limitation, not a silent hole.

---

## 3. Frontend contract (the "three buttons")

`GET /api/v1/payment/gateways` →
```json
{ "success": true, "statusCode": 200, "message": "Payment gateways fetched successfully",
  "data": { "gateways": ["bkash", "sslcommerz", "stripe"] } }
```
Enabled = adapter `isEnabled()` (required env creds present). `pay-deposit` /
`invoice pay` bodies accept `{ "gateway": "sslcommerz" }` (validated enum,
default `bkash`, 400 `"Unsupported or disabled payment gateway"`). Response
shape `{ payment, paymentUrl }` unchanged for all gateways (SSLCommerz returns
`GatewayPageURL`, Stripe the Checkout Session URL — both are browser redirects).

---

## 4. Audit footprint (error traceability)

New audit actions (all written by `settle.ts` / initiation code, atomic or
post-commit fail-soft as appropriate):

| Action | When | Carries |
|---|---|---|
| `PAYMENT_INITIATED` | session created (any gateway) | gateway, providerPaymentId, amount, purpose |
| `PAYMENT_SETTLED` | PAID transition (any gateway) | gateway, providerTrxId, amount, amountVerified: true |
| `PAYMENT_FAILED` / `PAYMENT_CANCELLED` | provider-reported failure/cancel | gateway, raw status |
| `PAYMENT_AMOUNT_MISMATCH` | I-G2 trip | gateway, expected vs reported amount |
| `PAYMENT_STALE_FLAGGED` | cron finds a stale PROCESSING row whose provider reports paid/ambiguous | gateway, provider verdict — routes to the admin settle queue |
| `PENDING_SETTLEMENT_RESOLVED` | admin settles or downgrades a stranded row | gateway, outcome SETTLED/NOT_SETTLED, provider evidence |
| `PAYMENT_STALE_RECONCILED` | cron resolves stale PROCESSING (fail/cancel only) | gateway, outcome |

Diagnostic path for any payment incident (three hops, always):
`audit_logs` (action + gateway + provider refs) → `payments` row
(`gateway`, `providerPaymentId/TrxId`, `status`, `gatewayResponse` raw payload)
→ the notify route's distinct error message. Plus the existing
REFUND_PENDING admin queue for refund ambiguity.

---

## 5. Phases & change manifest

### M0 — credentials & env plumbing (no code)
- Copy from reference `.env` files into our `.env` (gitignored): SSLCommerz
  sandbox `SSL_COMMERZ_STORE_ID/PASSWORD` + init/validate URLs; Stripe test
  `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; add `BACKEND_PUBLIC_URL`
  (= existing `BACKEND_URL`) usage.
- `.env.example`: placeholders only (`your_sslcommerz_store_id_here`, etc.).
- `config/index.ts`: new keys.
- Deps: `stripe`, `axios` (SSLCommerz pattern is axios form-urlencoded — kept
  for pattern fidelity; bKash stays on fetch).
- **Verify:** server boots; nothing else changed. Commit: `chore(payments): multi-gateway env and dependencies`.

### M1 — gateway-neutral core + bKash behind the adapter (behavior-identical)
- Migration (§2.3): enum column + backfill + legacy-column drop + snapshot
  columns + gateway-scoped index. **No renames.** Pre-drop safety: grep the
  codebase for any `paymentGateway` **read** (queries/analytics) before the
  DROP — writes relied on the DB default, so the drop must be provably
  read-free.
- `lib/payments/{types,registry,settle}.ts`; bKash refactored to implement the
  interface (reading/writing the legacy-named columns as provider-neutral
  storage); `paymentCallback` (legacy route) now routes through
  adapter+settle but produces byte-identical outcomes.
- `pay-deposit` / `invoice pay` gain `gateway` param (validated; only bkash
  enabled at this point).
- `GET /payment/gateways`; `PAYMENT_INITIATED/SETTLED/FAILED/CANCELLED` audits;
  I-G2 amount snapshot; I-G4 conditional failure writes; provider HTTP
  timeouts on the remaining bKash calls (create/execute — refund already has
  one) as cheap independent hardening.
- Admin settle queue (§2.2) — landed here, not M4: it is the safety net for
  the invariant changes above and small enough to ship with the core.
- **HARD MERGE BLOCK — M1 gate:** full bKash regression smoke must be 100%
  green (deposit → lease + bed + receipt, invoice pay, callback replay no-op,
  failure/cancel, duplicate-session 409, refund saga + REFUND_PENDING queue,
  admin reconciliation) + unknown-gateway 400. No M2 work starts before this
  passes. Commit: `feat(payments): gateway-neutral ledger with bkash adapter`.

### M2 — SSLCommerz (GearUp pattern, sandbox)
- `lib/sslcommerz.ts`: `initiate` = form-urlencoded axios POST (store creds,
  `tran_id = TRNX_ID_<timestamp>`, success/fail/cancel →
  `${BACKEND_PUBLIC_URL}/api/v1/payment/confirm?paymentId=..&tranId=..&status=..`,
  ipn → `/ipn?paymentId=..&tranId=..`, customer fields from payer profile);
  `verifyAndSettle` = validator API with `val_id` + store creds — the ONLY
  accepted tokens are **`VALID` and `VALIDATED`** (pinned exactly, matching
  the GearUp implementation; any other token → FAILED); `method: card_type`
  stored in `gatewayResponse` raw (GearUp stores `card_type` as method — we
  keep it inside the raw payload + audit). Some store configs additionally
  POST a `verify_sign`/`verify_key` hash — documented as an available second
  layer, **not** implemented (validator API with store credentials is the
  trust anchor, per the reference pattern).
- Routes `/payment/confirm` (redirect to `${frontend_url}/dashboard/...` per
  purpose, mirroring our bKash redirect targets) and `/payment/ipn` (JSON 200),
  mounted pre-rate-limiter.
- **Verify:** init returns GatewayPageURL; `/confirm` + `/ipn` handlers against
  a locally forged-but-credentialed validation flow where sandbox allows;
  idempotent double-confirm (alreadyProcessed); amount-mismatch path
  (hand-crafted); failure/cancel redirect. Commit: `feat(payments): sslcommerz adapter with validated settlement`.

### M3 — Stripe (Prisma Press pattern, test mode, international) — **structurally droppable phase**
Nothing before or after M3 depends on it; skipping it costs nothing
structurally (the registry simply reports two gateways). Kept per the user's
explicit requirement (bKash/SSLCommerz for BDT, Stripe for international);
sequenced last so the time-budget call stays open until everything else is
green.
- `lib/stripe.ts` singleton; adapter `initiate` = Checkout Session
  (`mode: "payment"`, inline `price_data` with currency from
  `STRIPE_CURRENCY` (default `usd`) and `unit_amount` converted via
  `STRIPE_BDT_TO_BASE` demo-rate env — **demo-scoped conversion**: at settle,
  I-G2 verifies the actual charged minor units **re-read from the Stripe
  event (`amount_total`)**, never our own conversion; success/cancel URLs →
  frontend; `metadata: { paymentId }`).
- Webhook route `/payment/webhook/stripe` with `express.raw` mounted **before**
  `express.json()` in `app.ts` (Prisma Press placement); `constructEvent`
  signature verification. **Event allowlist**: only
  `checkout.session.completed` (with `payment_status === "paid"`) and
  `checkout.session.expired` (applies only while the local row is still
  PROCESSING — I-G4) are processed; everything else is logged and acked 200.
  **Idempotency** is keyed on the Stripe `event.id` (stored inside the raw
  payload) plus the existing row-status guards, so provider retries are
  strict no-ops; the event's `amount_total` is the amount of record.
- Stripe refund in the termination saga (§2.5).
- **Verify:** `stripe listen`-style local webhook test (or CLI trigger) with
  test card; signature-forgery → 400; replay → no-op; expired session while
  PROCESSING → CANCELLED (while terminal → no-op); termination refund on a
  Stripe-paid deposit → REFUNDED. Commit: `feat(payments): stripe adapter for international payments`.

### M4 — reconciliation, docs, collection
- Cron `reconcileStaleProcessingPayments` (00:25 daily + boot catch-up):
  PROCESSING rows older than 24h → per-gateway status query (SSLCommerz
  validator by tranId, Stripe session retrieve; bKash rows are probed via
  **idempotent re-execution** — executing a completed session returns the
  transaction — optional but preferred over leaving them for admins; an
  **errored** probe is treated as ambiguous, not never-paid, so a transient
  gateway fault can never wrongly downgrade a row). Verdict handling:
  definitive **failed/expired** →
  downgrade (conditional, I-G4); definitive **paid** or **ambiguous** → leave
  PROCESSING and flag into the admin settle queue
  (`PAYMENT_STALE_FLAGGED` audit). Never auto-settles (I-G5).
- Specs 00/12/15 (+09/11 initiation param; spec 15's route table gains the
  pending-settlements pair + `ResolvePendingSettlementZodSchema`) updated;
  `AGENTS.md` money rules
  extended; Postman collection regenerated with the new routes **and the
  three new env keys** added to the collection environment + README
  (`SSL_COMMERZ_STORE_ID/PASSWORD`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  placeholders).
- Commit: `feat(payments): stale-session reconciliation cron` + `docs(payments): multi-gateway specs`.

**Explicitly untouched:** lease/bed occupancy logic, invoice splitting,
membership money-firewall, application review flow — adapters only replace the
*provider transport* around them.

---

## 6. Risk register

| # | Risk | Mitigation |
|---|---|---|
| R1 | bKash regression during M1 refactor | Byte-identical outcome requirement + full bKash smoke rerun as a **hard merge block** before M2; single revert commit |
| R2 | Schema churn misses a reference | **Eliminated by design**: M1 is additive-only (enum column + backfill + legacy-column drop + snapshots + index), zero renames; the code sweep is tiny. Cosmetic renames deferred to an optional post-M3 cleanup |
| R3 | Stripe webhook hangs on parsed body | Raw mount BEFORE json (reference placement, verified in Prisma Press app.ts) |
| R4 | Rate limiter throttles provider retries | Notify routes mounted pre-limiter (health placement) |
| R5 | Forged SSLCommerz/IPN callbacks | Server-side validation API with store creds is the trust anchor (GearUp pattern); only `VALID`/`VALIDATED` verdicts settle; query params alone never settle |
| R6 | Underpayment via webhook amount tamper | I-G2: charged-amount snapshot at initiation + event-sourced amount at settle; `PAYMENT_AMOUNT_MISMATCH` never settles |
| R7 | Out-of-order events (late success after cancel) | I-G3/I-G4 conditional writes; late success on terminal rows → audit + stay terminal (money already refunded/voided at gateway → admin queue) |
| R8 | Stripe BDT conversion drift | Demo-rate env is initiation-only; settlement verifies the event's actual `amount_total` (minor units) |
| R9 | Secrets leak | Real values only in gitignored `.env`; plan + `.env.example` carry placeholders only |
| R10 | Stale PROCESSING locks a tenant out of retrying | Existing FAILED/CANCELLED retry rule kept; M4 cron downgrades definitive failures; admin settle queue resolves everything else |
| R11 | Stranded success (provider captured money, notification lost) | Admin settle queue (§2.2): status-query verdict "paid" routes to admins who settle through the same guarded `settle.ts` path — the success-side mirror of REFUND_PENDING reconciliation |

---

## 7. Rollback

M1–M4 are four independent commit groups; each is revertible in isolation.
The M1 migration is additive (enum column + backfill + legacy-column drop +
snapshots + index; no renames, data preserved) — reverting the code without
the migration leaves the extra columns harmless; a true rollback reverts code
and applies a reverse migration. No existing row's status/amount is ever
modified by the multi-gateway work itself.

---

## 8. Verification matrix (per phase, live)

**M1 (bKash, must be 100% green before M2 — hard merge block):** deposit happy path (lease
created, bed occupied, receipt email, `PAYMENT_INITIATED`+`PAYMENT_SETTLED`
audits) · invoice pay · callback replay no-op · failure/cancel transitions ·
duplicate-session 409 · refund saga + REFUND_PENDING queue · admin
reconciliation · **admin settle queue: process a PROCESSING row via resolve
(SETTLED → lease/bed/invoice side effects happen through the same settle path;
NOT_SETTLED → FAILED, tenant can retry; double-resolve → 409)** · `gateways`
returns `["bkash"]` · `gateway: "stripe"` → 400 (disabled).

**M2 (SSLCommerz):** initiate → 200 `{payment, paymentUrl}` (GatewayPageURL),
row PROCESSING with `providerPaymentId=tranId` + snapshot · forged `/confirm`
without valid `val_id` → FAILED, no settle · idempotent double-IPN ·
amount-mismatch row stays PROCESSING + audit · cancel redirect target ·
`gateways` now `["bkash","sslcommerz"]`.

**M3 (Stripe):** session URL + metadata paymentId · webhook with valid
signature (Stripe CLI test event) → settle + audits · invalid signature → 400
· replay → no-op (event.id guard) · non-allowlisted event → acked, no state
change · expired session while PROCESSING → CANCELLED (while terminal →
no-op) · amount mismatch (tampered event) → stays PROCESSING + audit ·
termination refund on a Stripe-paid deposit → REFUNDED · `gateways` full
list.

**M4:** stale PROCESSING (>24h) with definitive provider failure → downgraded;
provider "paid"/ambiguous → flagged into the admin settle queue
(`PAYMENT_STALE_FLAGGED`) and resolvable via the M1 endpoints; bKash stale
rows probed via idempotent re-execution and routed the same way (completed →
queue; errored probe → ambiguous → queue; never auto-downgraded on an error).

---

## 9. Open decisions (defaults chosen)

| Decision | Default | Alternative |
|---|---|---|
| Stripe currency handling | `STRIPE_CURRENCY=usd` + `STRIPE_BDT_TO_BASE` demo rate; settlement verifies the event's actual `amount_total` | BDT pass-through (Stripe unsupported) — rejected |
| Stripe timing (review flag) | Keep M3 per the user's explicit three-gateway requirement, sequenced last and structurally droppable | Skip Stripe — open decision, deferred until M0–M2 are green (reviewer's recommendation) |
| Column renames | Deferred: additive-only M1; legacy names stay as provider-neutral storage; optional cosmetic cleanup post-M3 | Rename in M1 — rejected (top self-inflicted regression risk, zero behavior value) |
| Gateway choice default | `bkash` when body omits `gateway` | require explicit — rejected (backward compat) |
| Legacy bKash callback path | kept at `GET /payment/callback` (merchant portal already points there) | move to `/callback/bkash` — rejected (breaks in-flight) |
| SSLCommerz automated refunds | not in scope (manual/admin) | managed-transaction API integration — future |
| Stripe customer objects | none (one-time payments, metadata-only) | customer reuse (Prisma Press pattern) — revisit if subscriptions come |
| HTTP client for SSLCommerz | axios (pattern fidelity to GearUp, per user requirement) | native fetch form-urlencoded — noted as the cleaner option, consciously declined |
