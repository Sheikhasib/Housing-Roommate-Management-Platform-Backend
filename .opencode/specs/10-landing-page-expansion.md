# Spec 10 — Landing page expansion

## Overview
Home page today is hero + featured grid (2 sections) with **no footer anywhere**
in the app. This spec: lifts the navbar to the brief's route minimums, makes
the hero interactive + height-constrained, adds 8 real-data sections, and builds
a functional footer for both the public and dashboard layouts.

## Depends on
Spec 09 (accent tokens exist before new sections are styled).

## Navbar (`components/shared/navbar.tsx`)

Current (verified):
```ts
const navItems = [
  { label: "Home", href: "/" },
  { label: "Browse Gear", href: "/gears" },
  { label: "About", href: "/about" },
  { label: "Services", href: "/services" },
  { label: "Contact", href: "/contact" },
]
```
Logged-out = 5 routes (already ≥4, keep). Profile dropdown already exists.

### Logged-in ≥6 routes
- Add a `Dashboard` link to `navItems` **only when `user?.success`**:
  `{ label: "Dashboard", href: "/customer-dashboard" }` and at render time swap
  the href by role: CUSTOMER → `/customer-dashboard`, PROVIDER →
  `/provider-dashboard`, ADMIN → `/admin-dashboard`.
- Route count when logged in: Home, Browse Gear, About, Services, Contact,
  Dashboard = **6** (dropdown counts separately).

### Mobile drawer (new)
- Public navbar links are `hidden md:flex` — no mobile menu exists for public
  pages. Add a mobile trigger button (hamburger, `List`/`Menu` from
  `@phosphor-icons/react`) visible below `md`, opening a `Sheet` (reuse
  `components/ui/sheet.tsx`) with the nav links + login/register or profile
  dropdown, matching the dashboard's `Sheet` drawer pattern.

### Dropdown additions
- Add `{ label: "Help", href: "/help" }` to `userMenuItems` (Help page built in
  spec 15). Keep Profile + Dashboard + Log out.

## Hero (`app/(publicGroup)/page.tsx`)

Current: `section.min-h-[70vh]` static text + 2 CTAs.

- Constrain: change to `min-h-[60svh] max-h-[70svh]`.
- Interactive element: rotate the **3 featured gear images** from
  `getFeaturedGear()` as a cross-fade background using `framer-motion`
  (`AnimatePresence` + `motion.img` opacity tween, `mode="wait"`, 6s interval,
  pause on hover), with a caption overlay (gear name + price/day) per slide.
- CTA buttons unchanged: `Browse Gear` → `/gears`, `Explore` → `/gears`.
- Visual cue into next section: a `ChevronDown` icon centered at the hero
  bottom with `animate-bounce`, linking to `#categories` anchor.

## Sections (`app/(publicGroup)/page.tsx` + `components/sections/`)

New section components are **Server Components** — no `"use client"`, no client
fetch. They receive data via props from the page's server-side fetches.

Build order of sections on the page:
1. `HeroSection` — inline (existing, upgraded).
2. `CategoryGrid` (`components/sections/category-grid.tsx`) — props
   `{ categories: ICategory[] }`; fetch `GET /api/categories` in the page via
   the existing `lib/api/categories.ts` (`fetchCategories`, client hook is
   `hooks/useCategories.ts`; server-side call uses
   `process.env.BACKEND_API_URL`). Each card: category name + count of gear
   (count fetched via `GET /api/gear?categoryId=<id>&limit=1` meta.total —
   page does `Promise.all` over categories), `Link` → `/gears?categoryId=<id>`.
3. `FeaturedSection` (existing grid) — enrich each of the 6 featured items with
   `rating`/`reviewCount` by calling `fetchGearById(id)` server-side in
   `Promise.all` (detail returns `reviews`, compute avg). Pass to `GearCard`.
4. `HowItWorks` (`components/sections/how-it-works.tsx`) — static 3 steps,
   no fetch: (1) Search gear → (2) Book dates & confirm → (3) Pick up / return.
   Icon per step from `@phosphor-icons/react`.
5. `StatsStrip` (`components/sections/stats-strip.tsx`) — props
   `{ stats: { totalGear, totalCategories, totalReviews, avgRating } }`;
   page computes: totalGear from `GET /api/gear?limit=1` meta.total,
   totalCategories from categories length, totalReviews + avgRating from the
   featured detail fetches. Uses `bg-accent-solid` for the number emphasis.
6. `TestimonialGrid` (`components/sections/testimonials.tsx`) — props
   `{ testimonials: { name: string; rating: number; comment: string }[] }` from
   the same featured detail fetches (flatten `reviews`, take 5). Star icons in
   `text-accent-solid`.
7. `FaqSection` (`components/sections/faq.tsx`) — static accordion using the
   radix `Collapsible` (check `components/ui` for an existing accordion; if
   none, build one `FaqItem` with `useState` open index — no new dependency).
   5 real Q&As (how booking dates work, availability, payment via SSLCommerz,
   cancellation policy, what happens after return).
8. `CtaBand` (`components/sections/cta-band.tsx`) — full-width
   `bg-primary` band: "Rent your gear today" → `/gears`, "Become a vendor" →
   `/register`. Note: register does **not** read a `role` query param today
   (verified) — optional stretch: add `searchParams.get("role")` prefill to
   `RegisterForm`; otherwise link plain `/register`.

## Footer (`components/shared/footer.tsx` + layouts)

New file `components/shared/footer.tsx` (Server Component, no fetch):
```tsx
export function Footer() { ... }
```
Columns (all links must resolve — About/Contact/Services/Help/Privacy pages all
exist after spec 15; until then use only live routes):
- Brand blurb + tagline
- Explore: Browse Gear (`/gears`), Services (`/services`), About (`/about`)
- Support: Help (`/help`), Contact (`/contact`), Privacy (`/privacy`)
- Get Started: Become a Vendor (`/register?role=PROVIDER`), Sign In (`/login`)
- Contact row: email `support@gearup.example` (mailto), phone, social icons
  (external `href`s, `target="_blank" rel="noopener noreferrer"`)
- Bottom bar: © year + "All rights reserved"

Mount:
- `app/(publicGroup)/layout.tsx` — append `<Footer />` after `{children}`.
- `app/(dashboardGroup)/layout.tsx` — append `<Footer />` after the
  `<main>`/`SidebarProvider` block.
- Sticky-to-bottom: make both layouts `flex min-h-screen flex-col` with the
  footer `mt-auto`.

## Rules for implementation
- Sections are Server Components receiving props; no client fetch in sections.
- No lorem ipsum, no fabricated stats/testimonials — all derived from API.
- Reuse `GearCard`, `Button`, `Card`, `Skeleton`; no new primitives.
- `next/image` with `sizes` for all images.
- Dark mode: amber accent works on dark (spec 09).

## Definition of done
- [ ] Logged-in navbar shows 6 routes incl. Dashboard; mobile drawer opens below `md`
- [ ] Hero is 60–70svh, auto-rotates the 3 featured items, has a down-chevron
- [ ] 8 sections present; stats + testimonials + categories come from the API
- [ ] Footer renders on public + dashboard layouts; every link resolves
- [ ] Commits: `feat: navbar dashboard link and mobile drawer`,
      `feat: interactive hero with featured carousel`,
      `feat: landing sections (categories, how-it-works, stats, testimonials, faq, cta)`,
      `feat: shared functional footer`
