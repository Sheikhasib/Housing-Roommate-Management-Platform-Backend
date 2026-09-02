# Spec 16 — Final polish & QA (Phase 2)

## Overview
Same role as Phase 1's Spec 07: a deliberate sweep pass after specs 09–15 are
functionally complete, checking finished work rather than papering over gaps.
Runs last, against the fully-built app.

## Depends on
Specs 09–15 functionally complete.

## Checklist to implement

### Loading & error boundaries
- `loading.tsx` for every **new** Phase 2 route:
  - `/admin-dashboard/analytics` (skeleton KPI cards + chart skeletons via
    `ChartCard` `loading` prop — Spec 14)
  - `/admin-dashboard/messages` (table skeleton — Spec 15)
  - `/gears/[id]` related section (already covered by the route's existing
    `loading.tsx`)
  - `/help`, `/privacy`, `/terms` (static — a simple page skeleton is fine, or
    none if the page has no async work)
- `error.tsx` nearest boundary already exists at root + `(publicGroup)` +
  `(dashboardGroup)`; confirm the new admin routes fall under one. Add a
  retry (`reset()`) + "Go home" link if the boundary doesn't already include it.

### Design-system audit re-verified on every new page
- Re-run the Spec 09 greps across specs 10–15 output:
  - `rg "<button" --glob '!components/ui/*'`
  - no inline hex/arbitrary color values outside `globals.css`
- Every card built in specs 10/14/15 (category cards, testimonial cards,
  ChartCard, stat cards) shares radius/padding/border with `GearCard` — do a
  visual side-by-side, not just a code read.

### Dark mode contrast re-check (esp. charts)
- recharts' default colors do **not** auto-adapt to CSS variables — confirm the
  Spec 14 color-map override renders correctly in `.dark` for axes, grid,
  tooltip text, and each series.
- Re-check the amber accent (`--accent-solid`) pairings on FAQ, stats, rating
  stars, and CTA band in dark mode.

### Forms audit (Spec 09/13/15 output)
- Every new form (profile, password change, contact, and the modified login)
  has: label-connected inputs, inline Zod errors, disabled/loading submit,
  success toast. Audit against the same standard Spec 07 set.

### No-placeholder sweep
- `rg "Coming soon|lorem|TODO|placeholder text" app/ components/` — zero
  matches in shipped routes. About/Contact/Services placeholders from Phase 1
  must be fully replaced (Spec 15).

### Dead-link sweep
- Crawl every route reachable from navbar, footer, dashboards, home sections,
  and CTA bands — each link must hit a 200 route (no `/help` before it exists,
  no `/admin-dashboard/analytics` before Spec 14).
- Confirm `/register?role=PROVIDER` and `/gears?categoryId=<id>` links behave.

### Mobile pass (new surfaces)
- Landing page's 8 sections (hero rotation, category grid, FAQ, CTA) at real
  mobile width.
- Dashboard charts at mobile width (charts are notorious for bad default
  responsiveness — test with an actual device or emulated viewport, not a
  browser resize).
- Admin messages table + analytics page; profile forms.
- Public navbar mobile drawer (Spec 10).

### Chart data honesty
- Open the analytics endpoints directly (or via the network tab) — confirm the
  numbers rendered match the API response exactly (no client-side invented
  values).

## Definition of done
- [ ] Full click-through of the deployed app on desktop + mobile, light + dark,
      with nothing broken or unfinished-looking
- [ ] The original upgrade brief's checklist can be gone through line-by-line
      with every item genuinely satisfied (not just technically present):
      1. Global UI/design, 2. Home/landing, 3. Cards, 4. Details, 5. Explore,
      6. Auth, 7. Dashboard, 8. Additional pages, 9. UX/responsiveness,
      10. Forms, 11. Backend, 12. Code quality
- [ ] `npm run typecheck`, `npm run lint`, `next build`, `npm test` all pass
- [ ] Commits: `fix: dark mode contrast pass on charts and new components`,
      `fix: mobile responsive pass on landing page and dashboards`,
      `chore: final QA pass against upgrade brief`
