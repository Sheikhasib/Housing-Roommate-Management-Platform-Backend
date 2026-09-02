# Spec 11 — Explore & detail page enhancements

## Overview
`/gears` already exceeds the brief's 2-field filter minimum (search, category,
brand, price, availability dates) and already has URL-driven pagination.
Missing: **sorting**, **specifications** and **related gear** on the detail
page, and **rating** on gear cards.

## Depends on
Spec 09 (tokens), Spec 10 (featured section consumes card ratings).

## Sorting (`/gears`)

### Backend (repo `GearUp-API-Backend`, `src/modules/gear/gear.service.ts`)
`getAllGears` already does dynamic `orderBy: { [sortBy]: sortOrder }` with
defaults `createdAt`/`desc` — verified. It does **not** whitelist sort keys.
Change `getAllGears`:
```ts
const SORTABLE: Record<string, 1 | -1> = {
  createdAt: -1, name: 1, priceRatePerDay: 1,
}
const sortBy = SORTABLE[query.sortBy] ? query.sortBy : "createdAt"
const sortOrder = query.sortOrder === "asc" ? "asc" : "desc"
```
(No schema change — only service/controller hardening. If you'd rather not touch
the backend, restrict the frontend to `createdAt` + `priceRatePerDay`, which the
dynamic sort already supports.)

### Frontend (`app/(publicGroup)/_components/gear/`)
- `GearFilters.tsx`: add a `sort` `<select>` next to the existing fields with
  options: Newest (`sortBy=createdAt&sortOrder=desc`), Price: low to high
  (`priceRatePerDay&asc`), Price: high to low (`priceRatePerDay&desc`), Name A→Z
  (`name&asc`). Wire it through the existing `onParamsChange` callback —
  `GearFilters` already debounces search/price via `useEffect`; mirror that
  pattern or change immediately (no debounce needed for a select).
- `GearsContent.tsx`: read `searchParams.get("sortBy")` / `("sortOrder")`,
  pass `sortBy`/`sortOrder` into `useGear({ ... })`, and include them in
  `handleParamsChange`/`handlePageChange` (they already preserve all params, so
  sorting survives pagination; ensure `page` resets to 1 on sort change via the
  existing `params.delete("page")`).
- `lib/api/gear.ts`: `fetchGear` already sets `sortBy`/`sortOrder` — no change.
- `lib/types.ts` `IGearQuery` already has `sortBy`/`sortOrder` — no change.

## Specifications block (`/gears/[id]`)

New file `app/(publicGroup)/gears/[id]/_components/Specifications.tsx`:
```tsx
interface SpecificationsProps { gear: IGearItem }
```
Render a `Card` with a `dl` grid of `CardField` rows (`components/shared/card-field.tsx`):
- Brand (`gear.brand`), Category (`gear.category.name`), Price/day
  (`$gear.priceRatePerDay`), Total stock (`gear.quantity`), Available now
  (`gear.availableQuantity`), Provider (`gear.provider.name`).
- Availability summary: if `gear.unavailableRanges?.length`, list up to 3
  ranges ("Unavailable: Jul 4 – Jul 6") using `date-fns` `format`; else
  "Available for all selected dates".
- Insert in `app/(publicGroup)/gears/[id]/page.tsx` between the description
  block and the reviews section.

## Related gear (`/gears/[id]`)

In `app/(publicGroup)/gears/[id]/page.tsx` (Server Component), alongside the
existing `getGearById(id)`:
```ts
const relatedRes = await fetch(
  `${API_URL}/api/gear?categoryId=${gear.categoryId}&limit=5`,
  { cache: "no-cache" }
)
const related = (relatedRes.ok ? (await relatedRes.json()).data : [])
  .filter((g: IGearItem) => g.id !== gear.id)
  .slice(0, 4)
```
- Render a `RelatedGrid` section below the reviews section using the existing
  `GearCard` in a `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6`.
- Hide the section when `related.length === 0`.
- Note: list endpoint returns bare `GearItem` (no category/provider) — cards
  render price/name/description only there, which is fine.

## Gear card rating

### `GearCard` (`app/(publicGroup)/_components/gear/GearCard.tsx`)
- Extend props:
```tsx
interface GearCardProps {
  gear: IGearItem
  rating?: number
  reviewCount?: number
}
```
- When `rating != null`, render a star row (one `Star` icon filled
  `text-accent-solid`, label `{rating.toFixed(1)}`) + muted
  `({reviewCount} reviews)` in the top row next to price.
- When absent, render nothing (browse grid unaffected).

### Featured enrichment (Spec 10)
- `app/(publicGroup)/page.tsx`: for the 6 featured ids, `Promise.all` over
  `getGearById`, compute `avgRating`/`reviewCount` from `gear.reviews`, pass to
  `GearCard`.

## Rules for implementation
- Sorting/filtering/pagination all URL-driven; Server Component first paint,
  TanStack Query in-page updates (existing pattern).
- Sort change resets `page` to 1.
- Related gear is a Server Component fetch, not a client round-trip.
- Reuse `GearCard`/`GearGrid` — do not create a second card component.

## Definition of done
- [ ] Sort options reorder results and persist through pagination; URL reflects
      `sortBy`/`sortOrder`; page resets on sort change
- [ ] Detail page shows a real specifications block
- [ ] Related gear shows 4 same-category items excluding the current one
- [ ] Featured cards show real avg rating + review count; browse grid unchanged
- [ ] Commits: `feat: sort controls on gear browse page`,
      `feat: specifications block on gear detail`,
      `feat: related gear section on gear detail`,
      `feat: rating display on featured gear cards`
