# Spec 02 — Public gear browsing

## Overview
Home page, browse/filter grid, and gear detail page. All public, all SEO-friendly Server Components for first paint, with TanStack Query taking over for in-page filter changes.

## Depends on
Spec 01 (layout/navbar).

## Routes
- `app/(publicGroup)/page.tsx` — home, `GET /api/gear?limit=6` server-side, featured grid + hero
- `app/(publicGroup)/gear/page.tsx` — full browse; reads `searchParams` for `search/category/minPrice/maxPrice/available/page`, fetches server-side (via `BACKEND_API_URL`) for first paint, hands off to a client `<GearFilters />` + `<GearGrid />` pair wired to TanStack Query for subsequent changes — calling the backend **directly** via `NEXT_PUBLIC_BACKEND_API_URL` (public data, no auth, no proxy hop needed) — and update the URL via `router.push` so filters stay shareable/bookmarkable
- `app/(publicGroup)/gear/[id]/page.tsx` — detail: image gallery, specs, provider info, reviews list, `<RentNowPanel />`

## Components
- `components/gear/GearCard.tsx` — `next/image`, price/day, category badge, availability badge
- `components/gear/GearFilters.tsx` — category select, price range, availability date range, debounced search input
- `components/gear/GearGrid.tsx` — skeleton state while TanStack Query refetches on filter change
- `components/gear/RentNowPanel.tsx` — date-range picker + quantity, writes selection into `store/rentSelectionStore.ts`, submit → Spec 03

## Loading & error
- `app/(publicGroup)/gear/loading.tsx`, `gear/[id]/loading.tsx` — skeleton grid / skeleton detail
- `app/(publicGroup)/gear/[id]/not-found.tsx` — bad gear ID
- `app/(publicGroup)/error.tsx`

## Rules for implementation
- Date picker in `RentNowPanel` must disable past dates and dates already booked — fetch gear detail's availability data to compute booked ranges (cross-reference the backend's overlap logic conceptually: any date range covered by a `PLACED/CONFIRMED/PAID/PICKED_UP` order on this gear item is unavailable — if the detail endpoint doesn't expose this directly, this is a legitimate small backend addition to flag, not something to fake client-side).
- Filter state lives in the URL (searchParams), not just component state — makes it shareable and lets the Server Component do the first fetch.

## Definition of done
- [ ] Home shows real featured gear from the backend
- [ ] Filters update the grid without a full page reload, URL reflects filter state
- [ ] Detail page renders gallery + provider info + reviews
- [ ] Commits: `feat: home page with featured gear`, `feat: gear browse with filters and TanStack Query`, `feat: gear detail page with rent-now panel`
