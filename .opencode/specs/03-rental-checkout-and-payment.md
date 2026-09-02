# Spec 03 — Rental checkout & payment (SSLCommerz)

## Overview
The core mandatory-requirement flow: place an order, get confirmed by a provider, pay via SSLCommerz, land on a real success/cancel page. This is graded directly (rubric item #6, 10%) and gates the whole assignment (payment is one of the six zero-or-nothing mandatory items).

## Depends on
Spec 00 (backend redirect fix — without it this spec cannot be completed), Spec 01 (auth), Spec 02 (rent-selection state).

## Server actions
- `createRentalOrderAction()` in `app/(publicGroup)/gear/[id]/_actions/rentalActions.ts` — reads `rentSelectionStore`, Zod-validates `{gearItemId, startDate, endDate, quantity}`, `POST /api/rentals`, **ignores any `paymentUrl` in the response** (see Plan §3), redirects to `/dashboard/customer` with a toast: "Order placed — waiting for provider confirmation."
- `createPaymentAction(rentalOrderId)` in `app/dashboard/customer/orders/[id]/pay/_actions/` — `POST /api/payments/create`, redirect (external) to the returned `paymentUrl`.

## Routes
- `app/dashboard/customer/orders/[id]/pay/page.tsx` — shown only when order status is `CONFIRMED`; renders order summary + a single "Pay with SSLCommerz" button calling `createPaymentAction`. If status isn't `CONFIRMED` yet, show a disabled state with the current status instead of the button.
- `app/payment/success/page.tsx` — reads `?orderId=`, re-fetches the order (`GET /api/rentals/:id`) to confirm it's actually `PAID` before showing the success state (don't trust the URL alone), shows order summary + link to dashboard.
- `app/payment/cancel/page.tsx` — same re-fetch pattern, shows a retry-payment CTA back to the pay page.

## Validation
`lib/validations/rental.ts` — `rentNowSchema`: `startDate < endDate`, both `>= today`, `quantity >= 1`.

## Rules for implementation
- Never mark the UI "paid" based solely on the redirect landing — always re-verify against `GET /api/rentals/:id`, since a user could hand-craft the success URL.
- The pay page must be defensive about order status: PLACED (not yet confirmed), CONFIRMED (show pay button), PAID+ (redirect to dashboard, nothing to pay).

## Definition of done
- [ ] Full loop works against SSLCommerz sandbox: rent → provider confirms (needs Spec 05 done, or test via API client) → pay → land on real `/payment/success` page → dashboard shows `PAID`
- [ ] Cancelling mid-checkout lands on `/payment/cancel` with a working retry
- [ ] Commits: `feat: rent-now order creation flow`, `feat: SSLCommerz payment initiation`, `feat: payment success/cancel pages with order re-verification`
