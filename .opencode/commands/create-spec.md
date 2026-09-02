---
description: Create a spec file for a new GearUp feature
argument-hint: "Feature name, e.g. public-gear-browsing or provider-dashboard"
allowed-tools: Read, Write, Glob, Bash(git:*)
---

You are a senior developer spinning up a new feature for GearUp, a sports gear rental marketplace.

Always follow AGENTS.md conventions (Next.js 16: proxy.ts not middleware.ts, params is Promise, Turbopack default).

User input: $ARGUMENTS

## Step 1 — Parse arguments

From $ARGUMENTS extract:

| Variable | Rule | Example |
|----------|------|---------|
| `feature_title` | Title Case, human readable | "Public Gear Browsing" |
| `feature_slug` | kebab-case, a-z0-9, max 40 chars | `public-gear-browsing` |
| `branch_name` | `feature/<slug>` | `feature/public-gear-browsing` |

Ask the user if ambiguous.

## Step 2 — Research codebase

Read these before writing the spec:

**Existing specs** — `.opencode/specs/*.md` (read them all, avoid duplication)

**Types** — `lib/types.ts`
- IGearItem, ICategory, IUser, IRentalOrder, IPayment, IReview
- ICreateGearPayload, IUpdateGearPayload, ICreateRentalPayload
- IApiResponse\<T\>, IGearQuery
- Enums: Role (CUSTOMER|PROVIDER|ADMIN), RentalStatus (PLACED|CONFIRMED|PAID|PICKED_UP|RETURNED|CANCELLED)

**API layer** — `lib/api/`
- `client.ts` — `apiClient<T>(endpoint, options?)` — base fetch, throws ApiError, includes credentials
- `gear.ts` — `fetchGear(query?)`, `fetchGearById(id)`
- `categories.ts` — `fetchCategories()`
- `provider.ts` — `createGear()`, `fetchMyGear()`, `updateGear()`, `deleteGear()`, `fetchIncomingOrders()`, `updateOrderStatus()`
- `rentals.ts` — `createRental()`, `fetchMyRentals()`, `fetchRentalById()`, `cancelRental()`

**Hooks** — `hooks/`
- `useGear.ts` — `useGear(query?)`, `useGearById(id)`
- `useCategories.ts` — `useCategories()`
- `useProvider.ts` — `useMyGear()`, `useCreateGear()`, `useDeleteGear()`, `useIncomingOrders()`, `useUpdateOrderStatus()`

**Shared components** — `components/shared/`
- `gear-image-upload.tsx` — Cloudinary upload widget wrapper, shows image previews with remove button

**Route groups** — `app/`
- `(publicGroup)/` — home, gear browsing, gear detail, payment pages (no auth required)
- `(authGroup)/` — login, register (redirect if authenticated)
- `(dashboardGroup)/` — customer/, provider/, admin/ with sidebar layout (auth required)

**Other files**
- `app/providers/query-provider.tsx` — TanStack QueryClientProvider setup
- `app/layout.tsx` — root layout wrapping QueryProvider + ThemeProvider
- `next.config.ts` — image remotePatterns for res.cloudinary.com + images.unsplash.com
- `proxy.ts` — (if exists) for auth token refresh + role-based routing
- `AGENTS.md` — project-specific Next.js 16 quirks

## Step 3 — Create branch

Run:
```
git checkout -b feature/<feature_slug>
```

If branch exists, check it out instead.

## Step 4 — Write spec

Generate a spec document with this exact structure:

```
# Spec: <feature_title>

## Overview

One paragraph describing what this feature does for GearUp.

## Depends on

List exact file paths this feature builds on, grouped by layer:
- `lib/types.ts` — specific types used
- `lib/api/<file>.ts` — API functions used
- `hooks/use<Name>.ts` — existing hooks used
- `components/shared/<file>.tsx` — existing components
- `app/(group)/` — which route group
- `proxy.ts` — auth protection needed? (role guard, redirect rules)

## Routes

- `GET /path` — description, auth required? role?

## New API functions

```
lib/api/<name>.ts
  fetchXxx(args) — GET /api/xxx — returns IApiResponse<Type>
  createXxx(payload) — POST /api/xxx — returns Type
```

## New Hooks

```
hooks/use<Name>.ts
  useXxx() — useQuery({ queryKey: [...], queryFn: fetchXxx })
  useCreateXxx() — useMutation({ mutationFn: createXxx, onSuccess: invalidate })
```

## Components

**Create:**
- `path/to/component.tsx` — what it renders, what props it takes

**Modify:**
- existing component — what changes

## Files to change

Exact file paths. One per line.

## Files to create

Exact file paths. One per line.

## New dependencies

List npm packages. If none: "No new dependencies."

## Rules for implementation

Specific GearUp constraints. Always include relevant items from this list:

### Data fetching
- Use TanStack Query hooks for all client-side data (`useQuery`/`useMutation`) — never raw fetch in components
- `useMutation` always includes `onSuccess` with `queryClient.invalidateQueries`
- Mutation buttons must show loading state + disabled attribute
- Skeleton components for loading state (never spinners for lists)
- Empty state message for every data list
- Error state with retry button

### Auth & routing
- proxy.ts guards role-based routes (CUSTOMER, PROVIDER, ADMIN)
- Dashboard pages read user from getMe() in layout, pass as context or re-fetch
- Auth pages redirect to dashboard if already logged in

### UI & animation
- All clickable elements need `cursor-pointer` + `transition-colors duration-200`
- Buttons use framer-motion `whileTap={{ scale: 0.97 }}`
- Card hover: `whileHover={{ y: -4 }}` (not scale — prevents layout shift)
- Lists use `motion.div` with stagger animation (`staggerChildren: 0.08`)
- Icons from `@phosphor-icons/react` — never emoji as icons
- Images use `next/image` with `fill` + `sizes` + `onError` fallback
- StatusBadge colors: PLACED=yellow, CONFIRMED=blue, PAID=purple, PICKED_UP=green, RETURNED=gray, CANCELLED=red
- shadcn/ui components from `components/ui/` — never create new primitives

### Styling
- Tailwind v4 `@theme` tokens (use `bg-primary`, `text-muted-foreground`, etc.)
- Dark mode via `dark:` variant
- `cn()` from `@/lib/utils` for className merging

## Definition of done

Testable checklist. Each item verifiable by running `npm run dev`.
```

## Step 5 — Save

Save to: `.opencode/specs/<feature_slug>.md`

## Step 6 — Report

```
Branch:    feature/<feature_slug>
Spec file: .opencode/specs/<feature_slug>.md
Title:     <feature_title>
```

"Review the spec then ask me to implement it."

## Example output

For reference, the existing 6 GearUp specs follow this exact format. Read one before writing if unsure.
