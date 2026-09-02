# Spec 01 — Project setup & auth

## Overview

Scaffold the app, wire up styling, and build the full auth flow: register, login, logout, role-aware middleware, and the Zustand store that holds the current user client-side. Everything downstream (dashboards, protected forms) depends on this.

## Depends on

Spec 00 (backend fixes don't block this one, but do them first anyway).

## New dependencies

```
zod react-hook-form @hookform/resolvers
@tanstack/react-query
zustand
sonner
jsonwebtoken (verifying tokens in middleware, using JWT_ACCESS_SECRET)
```

Plus shadcn/ui init (mirror press-frontend's setup: `class-variance-authority`, `radix-ui`, `tailwind-merge`, `lucide-react`, `next-themes`). Cloudinary needs no SDK dependency for the unsigned-upload approach used in Spec 05 — plain `fetch` to Cloudinary's upload endpoint is enough.

## Routes

- `app/(authGroup)/login/page.tsx`
- `app/(authGroup)/register/page.tsx`
- `app/(publicGroup)/layout.tsx` — navbar reads user from a Server Component call to `/api/auth/me`

## Server actions (`app/(authGroup)/_actions/authActions.ts`)

- `registerAction(prevState, formData)` — Zod-validate, `POST /api/auth/register`, on success redirect to login with a toast query param
- `loginAction(prevState, formData)` — Zod-validate, `POST /api/auth/login`, read `{accessToken, refreshToken}` from JSON body, `cookieStore.set()` both as httpOnly, redirect to `/dashboard/{role}`
- `logoutAction()` — clear cookies, redirect `/`

## Middleware (`proxy.ts`)

- Read access-token cookie, **verify** it with `jwt.verify(token, process.env.JWT_ACCESS_SECRET)` — the frontend `.env` carries the same secret the backend signs with, so do a real signature check, not a blind decode. A blind `jwt.decode()` lets anyone forge a `role` claim client-side; `verify()` doesn't.
- Verification throws (missing/expired/tampered) or no cookie + hitting `/dashboard/**` → redirect `/auth/login?from=<path>`
- Verified, role mismatch for the dashboard branch being hit → redirect to `/dashboard/{their-role}`
- Matcher: `/dashboard/:path*`

## State

`store/authStore.ts` — Zustand store: `{ user, setUser, clear }`, hydrated client-side from a small `/api/be/auth/me` call in the root layout's client boundary (or passed down as initial state from the Server Component navbar — prefer this, avoids an extra request).

## Validation schemas (`lib/validations/auth.ts`)

`registerSchema` (name, email, password min 8, role enum, phone optional), `loginSchema` (email, password) — reused by both the RHF form and the server action's own `.parse()`.

## Rules for implementation

- Never store tokens in localStorage — httpOnly cookies only, per assignment's JWT-storage rubric line.
- Toasts via `sonner` for both success and failure — install the `<Toaster />` once in the root layout.
- Every RHF form shows inline field errors _and_ a top-level toast only for non-field errors (network failure, 500).

## Definition of done

- [ ] Register → login → land on correct role dashboard root works end-to-end against the real backend
- [ ] Visiting `/dashboard/provider` as a customer bounces to `/dashboard/customer`
- [ ] Visiting any `/dashboard/**` logged out bounces to `/auth/login`
- [ ] Commits: `feat: scaffold Next.js app with Tailwind/shadcn`, `feat: auth server actions with Zod validation`, `feat: role-based middleware`, `feat: auth zustand store`
