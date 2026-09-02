# Spec 15 — Contact & static pages

## Overview
About, Contact, and Services are currently "Coming soon." placeholders — a
direct violation of the brief's "no placeholder content" rule. This spec adds a
real contact form backed by a new `ContactMessage` model + admin inbox, and
builds real content for About, Services, Help, Privacy, and Terms.

## Depends on
Spec 09 (page layout/typography tokens), Spec 13 (navbar Help link resolves).

## Backend (repo `GearUp-API-Backend`)

### New `ContactMessage` model (`prisma/schema/contactMessage.prisma`)
```prisma
model ContactMessage {
  id        String   @id @default(uuid())
  name      String
  email     String
  subject   String
  message   String
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@map("contact_messages")
}
```
Update `prisma/schema/schema.prisma` to reference it, run
`npx prisma migrate dev --name add_contact_message`.

### New `src/modules/contact/` module (route/controller/service)
- `POST /api/contact` — **public** (no auth). Zod-validate body
  `{ name: string min 2, email: valid email, subject: string min 2, message:
  string min 10 }`; insert; return the created row or `{ success: true }`.
  No rate-limiting middleware exists — do not add a dependency for one route.
- `GET /api/admin/contact-messages` — `auth(Role.ADMIN)`, paginated
  (`?page=&limit=`), newest first, returns rows + `meta` envelope.
- Wire into the same server bootstrap where the other routes mount.

## Frontend (repo `GearUp-Frontend`)

### Contact page (`app/(publicGroup)/contact/page.tsx` — replace placeholder)
- New `components/sections/contact-form.tsx` (`"use client"`):
  - RHF + Zod (`lib/validations/contact.ts`: `contactSchema` = name min 2,
    email, subject min 2, message min 10), labeled inputs per Spec 09.
  - Submit → `createContactMessage(payload)` via new `lib/api/contact.ts`:
    ```ts
    export async function createContactMessage(payload: IContactPayload): Promise<{ success: boolean }>
    ```
    using `apiClient("/contact", { method: "POST", body: JSON.stringify(payload) })`.
  - On success: `toast.success("Message sent — we'll reply soon.")`, reset form.
    On failure: `toast.error(error.message)` + keep input values.
  - Loading state: submit button `disabled` + "Sending…" while pending.
- Page also shows contact details (email mailto, phone, socials) + a simple
  FAQ/pointer to `/help`.
- Add `IContactPayload` + `IContactMessage` types to `lib/types.ts`.

### Admin inbox (`app/(dashboardGroup)/admin-dashboard/messages/page.tsx` — new)
- Table of `ContactMessage`s: name, email, subject, message (truncated with
  expand), createdAt. TanStack Query + the existing `Pagination` component.
- New `lib/api/contact.ts`:
  ```ts
  export async function fetchContactMessages(page?: number, limit?: number): Promise<IContactListResult>
  ```
  using `apiClientFull("/admin/contact-messages?...")`; hook
  `app/(dashboardGroup)/_hooks/useContact.ts` `useContactMessages(page)`.
- Add `Messages` (`/admin-dashboard/messages`, `ChatCircleText` icon) to
  `ADMIN_SIDEBAR_ITEMS`.
- `loading.tsx` + `error.tsx` for the route.

### Help page (`app/(publicGroup)/help/page.tsx` — new)
- Reuse the `FaqSection` content from Spec 10 (export the FAQ data array from
  `components/sections/faq.tsx` as `faqItems` so both pages share one source).
- Add "Gear Guides / How-to" section — static, real copy (e.g. "How to choose
  the right bike size", "What to check when picking up gear"). No backend.
- Support callouts: link to `/contact`.

### About page (`app/(publicGroup)/about/page.tsx` — replace placeholder)
Real content, no lorem: mission ("rent instead of buy"), how the marketplace
works (customers/providers/admin), platform values, a small stats block reusing
the stats derivation pattern from Spec 10 if present.

### Services page (`app/(publicGroup)/services/page.tsx` — replace placeholder)
- Real services grid: gear categories (link to `/gears`), how renting works
  (3-step), payment (SSLCommerz), safety/return guidance. Static, real copy.

### Privacy page (`app/(publicPage)/privacy/page.tsx` — new)
- Genuine privacy policy text for the platform (data collected, cookies,
  payments, contact). Standard boilerplate is acceptable here — these are the
  one place generic content is expected. Clearly marked as a summary.
- Add `/privacy` to the footer (Spec 10) and to `PUBLIC_ROUTES` in `proxy.ts`
  if needed (public pages don't require auth, but confirm it isn't accidentally
  caught by the matcher).

### Terms page (`app/(publicGroup)/terms/page.tsx` — new)
- Rental terms: booking dates, availability, payment, cancellations, damages,
  provider responsibility. Real copy. Add to footer.

## Rules for implementation
- Contact form uses the exact form conventions from Spec 07/09: labeled inputs,
  inline Zod errors, loading state, success/failure toast.
- No lorem ipsum anywhere on these pages.
- Every footer/nav link to these pages must resolve (build pages before/with
  the links).

## Definition of done
- [ ] Contact form submits successfully; submission appears in the admin inbox
- [ ] About/Services/Help/Privacy/Terms all have real, non-lorem content styled
      to the design system
- [ ] Admin sidebar shows Messages; table paginates and filters by text
- [ ] Footer + navbar links to these pages all resolve
- [ ] Commits (backend): `feat: add contact message model and routes`.
      (frontend): `feat: contact page with form`,
      `feat: about, services, help, privacy, and terms pages`,
      `feat: admin contact message inbox`
