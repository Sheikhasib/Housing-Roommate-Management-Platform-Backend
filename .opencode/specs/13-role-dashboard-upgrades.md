# Spec 13 — Role dashboard upgrades

## Overview
Sidebar nav counts are under the brief's minimums (Customer 3 vs ≥4, Admin 5 vs
≥6). The profile page exists read-only with no edit form, and there's no
password change. This spec brings dashboards to the minimums with real pages,
and turns profile into an editable page with independent password change.

## Depends on
Spec 09 (tokens). Note: `PATCH /api/auth/profile` **already exists** in the
backend (`src/modules/auth/auth.service.ts` `updateProfile`) supporting
`name`, `phone`, `avatarUrl`, `currentPassword`, `newPassword` — no new backend
endpoint; only the OAuth "set password" tweak from Spec 12 may touch it.

## Sidebar minimums (`app/(dashboardGroup)/_config/sidebarMenuItems.ts`)

Current (verified):
```ts
const CUSTOMER_SIDEBAR_ITEMS = [Dashboard, My Orders, Payments]            // 3
const PROVIDER_SIDEBAR_ITEMS = [Dashboard, My Gear, Orders, Add Gear]      // 4
const ADMIN_SIDEBAR_ITEMS   = [Dashboard, Users, Gear, Orders, Categories] // 5
```

### Customer (3 → 4+)
Add:
- `{ label: "Profile", href: "/profile", icon: UserCircle }` (public profile
  route already exists; made editable in this spec).

### Provider (4 → 5)
Add:
- `{ label: "Profile", href: "/profile", icon: UserCircle }`

### Admin (5 → 6+)
Add:
- `{ label: "Analytics", href: "/admin-dashboard/analytics", icon: ChartLine }`
  (page built in Spec 14 — do not link until that page exists)
- `{ label: "Profile", href: "/profile", icon: UserCircle }`

Imports for the new icons from `@phosphor-icons/react`: `UserCircle`,
`ChartLineUp` (confirm exact export names at implementation).

Every sidebar entry must resolve to a real page — no placeholder links.

## Dashboard navbar dropdown (`components/shared/navbar.tsx`)

The navbar is shared between public + dashboard layouts already. The avatar
dropdown currently has Profile, Dashboard, Log out. Per the brief, ensure it
lists: **Profile** (`/profile`), **Help** (`/help`), **Log out**. Add the Help
item in this spec (Help page content lands in Spec 15; `/help` route can be a
minimal page here so the link resolves).

## Profile page — editable (`app/(publicGroup)/profile/page.tsx`)

Convert the read-only `CardField` display into an editable profile. Keep the
account summary card (avatar, status badge, role, member-since).

### New server action `app/(publicGroup)/_actions/profileActions.ts`
```ts
"use server"
export type ProfileActionState = { success: boolean; message: string; errors?: Record<string, string[]> }
export const updateProfileAction = async (prev: ProfileActionState, formData: FormData): Promise<ProfileActionState>
export const changePasswordAction = async (prev: ProfileActionState, formData: FormData): Promise<ProfileActionState>
```
- `updateProfileAction`: Zod-validate `{ name (min 2), phone (optional),
  avatarUrl (optional url) }`, `PATCH /api/auth/profile` with the same
  httpOnly-cookie Bearer pattern as `client.ts` (use a server-side fetch with
  `Cookie: accessToken=<getAccessToken()>` like `getMe.ts`), then
  `revalidateTag("my-profile")` so the navbar/profile re-fetch fresh.
- `changePasswordAction`: Zod-validate `{ currentPassword, newPassword (min 4),
  confirmPassword }` + `.refine(newPassword === confirmPassword)`, same `PATCH
  /api/auth/profile` with `{ currentPassword, newPassword }`.
- Both return field errors inline + a `message` for toast.

### New form components (`components/shared/`)
- `ProfileForm.tsx` — `"use client"`, RHF + Zod (`zod` schema in
  `lib/validations/profile.ts`), prefilled from `getMe()` data, fields:
  Name, Phone, Avatar URL with the Cloudinary uploader
  (`app/(dashboardGroup)/_components/gear-image-upload.tsx` — refactor to a
  shared `components/shared/image-upload.tsx` taking `value`/`onChange` since
  the uploader is currently provider-specific; reuse its `uploadPreset:
  "gearup_products"` pattern). Submit → `updateProfileAction`, toast success
  (`sonner`), reset form to latest data.
- `PasswordForm.tsx` — separate RHF form (Current, New, Confirm), own submit
  state, posts `changePasswordAction`, clears fields on success. **Independent
  of ProfileForm** — a password typo must never block a name edit.
- Both forms use labeled inputs per Spec 09 (htmlFor/aria-describedby) and a
  disabled state + inline error while pending.

### Wiring
- `profile/page.tsx` renders `ProfileForm` + `PasswordForm` inside the existing
  detail card layout; pass `user` (from `getMe()`) as initial data.

## Rules for implementation
- Shared form components across roles (same page, different sidebar context) —
  no per-role profile pages.
- After save, navbar user updates: `revalidateTag("my-profile")` covers the
  `getMe()` server fetch (it has `tags: ["my-profile"]`); the navbar's
  `useEffect` re-syncs the Zustand store when `user` prop changes.
- Mutations toast success AND failure (Spec 07 standard).

## Definition of done
- [ ] Customer sidebar ≥4, Admin ≥6, all entries resolve to real pages
- [ ] Dashboard navbar dropdown lists Profile, Help, Log out
- [ ] Profile form loads real user data, saves successfully (avatar upload
      works), shows inline validation errors
- [ ] Password change works independently of profile-info save
- [ ] Navbar reflects updated name/avatar after save
- [ ] Commits: `feat: expand dashboard sidebars to role minimums`,
      `feat: editable profile page with avatar upload`,
      `feat: password change form`, `feat: dashboard navbar dropdown menu items`
