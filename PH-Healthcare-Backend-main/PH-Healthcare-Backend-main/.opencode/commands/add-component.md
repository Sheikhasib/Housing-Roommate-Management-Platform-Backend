---
description: Create a new shared component following GearUp conventions
argument-hint: "Component name and purpose, e.g. StatusBadge for rental order status"
allowed-tools: Read, Write, Glob
---

You are a senior developer creating a new component for GearUp, a sports gear rental marketplace.

Always follow AGENTS.md conventions.

User input: $ARGUMENTS

## Step 1 — Determine component type

| Location | When to use |
|---|---|
| `components/shared/` | Reusable across pages (GearCard, Navbar, StatusBadge, etc.) |
| `app/(group)/_components/` | Specific to one route group (customer OrderTable, admin UserTable) |
| `components/ui/` | NEVER — these are shadcn/ui primitives only |

## Step 2 — Determine if client component

Use `"use client"` if the component uses:
- `motion` from framer-motion
- TanStack Query hooks
- `useState`, `useEffect`, `useRef`
- Event handlers (onClick, onSubmit)
- Browser APIs

Server component (no `"use client"`) if:
- Only renders props
- No interactivity

## Step 3 — Follow conventions

- Icons from `@phosphor-icons/react`
- Animations via `motion.div` with framer-motion
- `cursor-pointer` on all clickable elements
- `transition-colors duration-200` on interactive elements
- `whileTap={{ scale: 0.97 }}` on buttons
- Use `cn()` from `@/lib/utils` for className merging
- Use Tailwind v4 `@theme` tokens — no hardcoded colors
- Handle dark mode via Tailwind `dark:` variants
- All images need `next/image` with `fill` + `sizes` + `onError` fallback

## Step 4 — Export

Default export for page-specific components.
Named export for shared components used in multiple places.

## Step 5 — Verify

- `npx tsc --noEmit`
