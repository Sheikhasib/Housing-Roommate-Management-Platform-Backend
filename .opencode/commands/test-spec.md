---
description: Implement a GearUp feature from its spec file
argument-hint: "Feature slug from .opencode/specs/, e.g. customer-dashboard"
---

You are a senior developer implementing a feature for GearUp, a sports gear rental marketplace, based on a spec document.

Always follow the conventions in AGENTS.md if it exists.

User input: $ARGUMENTS

## Step 1 — Locate the spec

1. Parse the feature slug from $ARGUMENTS.
2. Read `.opencode/specs/<slug>.md` — if it doesn't exist, ask for the correct slug.
3. Read `AGENTS.md`.
4. Read relevant existing files from the spec's "Depends on" section.

## Step 2 — Understand the architecture

This project uses:

| Area | Pattern |
|------|---------|
| **Framework** | Next.js 16 App Router (Turbopack default) |
| **Route groups** | `(publicGroup)/`, `(authGroup)/`, `(dashboardGroup)/` |
| **Data fetching** | TanStack Query in client components (`hooks/use*.ts`) |
| **API layer** | `lib/api/*.ts` — typed fetch functions using `apiClient` |
| **Mutations** | TanStack Query `useMutation` + `queryClient.invalidateQueries` |
| **Auth** | JWT in httpOnly cookies; `proxy.ts` for token refresh + role guard |
| **UI** | shadcn/ui in `components/ui/`; app components in `components/shared/` |
| **Icons** | `@phosphor-icons/react` |
| **Animation** | `framer-motion` (`motion` components) |
| **Image upload** | Cloudinary via `components/shared/gear-image-upload.tsx` |
| **Styling** | Tailwind v4 (`@import "tailwindcss"` + `@theme` directives) |
| **Types** | Centralized in `lib/types.ts` |
| **Theme** | next-themes with dark mode |
| **Forms** | shadcn/ui inputs + Zod validation |

## Step 3 — Plan implementation

Read the spec's "Files to change" and "Files to create". Create a step-by-step plan:

1. **New files** — create in correct locations
2. **Existing files** — read fully before editing
3. **Dependencies** — install if needed
4. **Verification** — `npx tsc --noEmit` then `npm run dev`

## Step 4 — Implement

Follow the spec strictly. After each logical chunk:

- Verify: `npx tsc --noEmit`
- Verify: `npm run lint`

## Step 5 — Verify

- Run `npm run dev` and confirm feature matches spec's "Definition of done"
- Run `npm run lint` and `npx tsc --noEmit` for regressions

## Step 6 — Report

Summarise what was implemented, which files were changed/created, and whether all verification passed. If anything in the spec could not be followed, explain why.
