---
description: Scaffold a new page in its route group with hooks and API functions
argument-hint: "Route path, e.g. /gear or /dashboard/customer"
allowed-tools: Read, Write, Glob, Bash(npm:*)
---

You are a senior developer adding a new page to GearUp, a sports gear rental marketplace.

Always follow AGENTS.md conventions.

User input: $ARGUMENTS

## Step 1 — Parse the route

From $ARGUMENTS extract:
- `route_path` — the URL path (e.g. `/gear`, `/dashboard/customer`)
- `title` — page title in Title Case (e.g. "Browse Gear", "Customer Dashboard")

Ask the user to clarify if ambiguous.

## Step 2 — Determine route group

Map the route to its route group:

| Route starts with | Route group | Layout |
|---|---|---|
| `/auth/` | `(authGroup)/` | Minimal, no sidebar |
| `/dashboard/` | `(dashboardGroup)/` | Navbar + sidebar |
| `/payment/` | `(publicGroup)/` | Public layout |
| `/gear` or `/` | `(publicGroup)/` | Public layout |

## Step 3 — Check dependencies

Read existing files to determine what's already wired:
- `lib/types.ts` — relevant types
- `lib/api/` — existing API functions
- `hooks/` — existing hooks
- Route group layout — verify route group exists

## Step 4 — Create files

For each new page, create:

1. **Page file:** `app/(group)/path/page.tsx`
   - `"use client"` if using TanStack Query hooks
   - Import existing hooks and components
   - Handle loading, empty, error states

2. **API functions** (if needed): `lib/api/<name>.ts`
   - Typed fetch using `apiClient`
   - One function per endpoint

3. **Hook** (if needed): `hooks/use<Name>.ts`
   - `useQuery` for reads, `useMutation` for writes
   - `queryClient.invalidateQueries` on success

4. **Components** (if needed): `app/(group)/_components/` or `components/shared/`

## Step 5 — Verify

- `npx tsc --noEmit`
- `npm run lint`

## Step 6 — Report

List all files created/modified and whether verification passed.
