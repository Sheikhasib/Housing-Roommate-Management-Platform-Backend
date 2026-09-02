# Spec 04 — Customer dashboard

## Overview
Order history, payment history, and the post-return review form.

## Depends on
Spec 01, 03.

## Routes
- `app/dashboard/customer/page.tsx` — Server Component shell (role check already done by middleware) rendering two client sections below

## Components
- `components/dashboard/customer/OrderHistoryTable.tsx` — TanStack Query (`useQuery` via `/api/be/rentals`), status badge per §"Rental Order Status" mapping in the assignment doc, action button per status: `CONFIRMED` → link to pay page, `RETURNED` + no review yet → "Leave Review" opens `ReviewForm`
- `components/dashboard/customer/PaymentHistoryTable.tsx` — TanStack Query (`/api/be/payments`), amount/status/date
- `components/dashboard/ReviewForm.tsx` — RHF + Zod (`rating 1-5`, `comment`), `POST /api/reviews` via server action, disabled/hidden if `order.review` already exists or status isn't `RETURNED` (mirrors backend's own guard — don't let the UI offer an action the API will reject)

## Rules for implementation
- Badge colors follow the assignment's table exactly: PLACED amber, CONFIRMED blue, PAID purple, PICKED_UP green, RETURNED gray, CANCELLED red — define once in `lib/badgeStyles.ts`, reuse in provider/admin views too.
- Empty states ("No orders yet — browse gear") not blank tables.

## Definition of done
- [ ] Order + payment history render live data, correct badges
- [ ] Review form only appears/succeeds exactly when backend would allow it
- [ ] Commits: `feat: customer order history table`, `feat: customer payment history table`, `feat: post-rental review form`
