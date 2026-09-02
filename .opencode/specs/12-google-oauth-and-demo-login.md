# Spec 12 — Google OAuth & Demo Login (Final)

## Overview

Two additions to auth:

1. **Google sign-in via Google Identity Services (GIS)** as the provider. The
   frontend obtains a Google **ID token** (JWT) and posts it to the backend; the
   backend verifies it (signature + audience), does find-or-create/link, and
   issues the same stateless JWT pair used by password login.
2. **Demo login** — three one-click buttons (Customer / Provider / Admin) under
   the login form that log in with real existing accounts (credentials held
   server-side on the frontend). No demo seeding in the DB.

### Why these decisions
- **ID-token flow over redirect/code-exchange or Passport** — reuses the exact
  cookie/JWT plumbing of password login, keeps the backend stateless, adds no
  frontend callback page, and `verifyIdToken()` does the crypto correctly (no
  hand-rolled token exchange, no CSRF state, no tokens in URLs).
- **Demo buttons with real accounts over seeded demo users** — the accounts
  `hasib@gmail.com` (customer), `rozen@gmail.com` (provider),
  `admin@gearup.com` (admin) already exist in the DB with real data. Buttons
  simply run a normal login. No seed changes.

## Depends on
Spec 13 — an editable profile page must exist so a newly linked Google account
has somewhere to land and a Google-only user can set a password.

## Backend (repo `GearUp-API-Backend`)

### 1. Dependency
```
npm i google-auth-library
```

### 2. Env (already present — no changes for backend)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BACKEND_PUBLIC_URL` already in
  `.env`/`.env.example` → `config.index.ts:26-27`.
- ⚠️ Google Cloud Console: register the frontend origin
  (`https://gear-up-frontend-hasib.vercel.app` + `http://localhost:3000`) as an
  **Authorized JavaScript origin** (OAuth 2.0 Client IDs → Authorized
  JavaScript origins). No redirect URI needed.

### 3. Prisma schema (`prisma/schema/user.prisma`)
```
  password String?          // was: String
  googleId String? @unique  // new
```
- Run `npx prisma migrate dev --name add_google_oauth`. Net migration SQL:
  `ALTER COLUMN "password" DROP NOT NULL`, `ADD COLUMN "googleId" TEXT`,
  `CREATE UNIQUE INDEX "users_googleId_key"`. Client regenerates automatically.

### 4. Google client (`src/lib/googleAuth.ts`, new)
```ts
import { OAuth2Client } from "google-auth-library";
import config from "../config";

export const googleClient = new OAuth2Client({
  clientId: config.google_client_id,
});
```

### 5. Route (`src/modules/auth/auth.route.ts`)
```ts
router.post("/google", authController.googleLogin);
```
Endpoint: `POST /api/auth/google` — **unauthenticated**, JSON
`{ idToken: string }`.

### 6. Service (`src/modules/auth/auth.service.ts`) — `googleLogin({ idToken })`
1. Verify: `googleClient.verifyIdToken({ idToken, audience: config.google_client_id })`
   → `ticket.getPayload()` → `{ sub, email, email_verified, name, picture }`.
   Invalid/expired ⇒ `AppError(401, "Invalid or expired Google ID token")`.
2. Find-or-create / link (3 branches):
   - user where `{ email }` and `googleId === sub` → **reuse**;
   - else user where `{ email }` and `googleId === null` → **link** by
     `update({ googleId: sub })` — only if `email_verified === true`
     (Google-verified email auto-link: deliberate, documented decision);
   - else **create**: `{ name, email, password: null, googleId: sub,
     avatarUrl: picture ?? null, role: "CUSTOMER", status: "ACTIVE" }`.
3. Guard: `status === "SUSPENDED"` → reject (mirror `loginUser`). Keep the
   guard behavior aligned with the PH-Healthcare backend implementation: no
   extra email normalization in `googleLogin` (the token email is used as-is,
   matching PH), and the suspended check is applied before linking/creating and
   again before token issuance.
4. Issue tokens: payload `{ id, name, email, role }` → `jwtUtils.createToken`
   access (1d) + refresh (30d). Return `{ accessToken, refreshToken }`.

### 7. Controller (`src/modules/auth/auth.controller.ts`) — `googleLogin`
Clone the existing `loginUser` controller: `catchAsync`, call service, set the
two httpOnly cookies (accessToken 24h, refreshToken 7d, `sameSite: "none"`,
`secure: false`), return `{ accessToken, refreshToken }` JSON via
`sendResponse`. No redirects.
- **Decision (locked): keep the `res.cookie(...)` calls** for parity with
  `loginUser`/`refreshToken`. They are redundant for the frontend (which mints
  its own `sameSite:"lax"` cookies from the response body; the cross-origin
  backend ones get dropped by Chrome anyway), but keeping them keeps all three
  auth controllers uniform and any backend-first consumer still gets cookies.
  Do not half-remove them.

### 8. Audit fixes for nullable password
**a. `loginUser` guard** (`auth.service.ts`, insert before `bcrypt.compare` at
line 74):
```ts
if (!user.password) {
  throw new AppError(400, "This account uses Google login. Set a password on your profile to enable password login.");
}
```
Prevents a crash (`bcrypt.compare(pw, null)` throws) and stops Google-only
accounts from being brute-forced.

**b. `updateProfile` "set password" branch** (replace the
newPassword-with-currentPassword block at line 151):
```ts
if (newPassword !== undefined) {
  if (typeof newPassword !== "string" || newPassword.length < 4) {
    throw new AppError(400, "New password must be at least 4 characters.");
  }

  if (existingUser.password === null) {
    // Google-only account: set (not change) a password — no current password
    data.password = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));
  } else {
    if (!currentPassword) {
      throw new AppError(400, "Current password is required to change your password.");
    }
    const isPasswordMatched = await bcrypt.compare(currentPassword, existingUser.password);
    if (!isPasswordMatched) {
      throw new AppError(400, "Current password is incorrect.");
    }
    data.password = await bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds));
  }
}
```

### 9. Seed — no changes
Keep admin + categories only. No demo accounts, no demo gear, no demo rentals.

## Frontend (repo `GearUp-Frontend`)

### 1. Env (frontend `.env` — gitignored)
```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=…
DEMO_CUSTOMER_EMAIL=hasib@gmail.com
DEMO_CUSTOMER_PASSWORD=12345
DEMO_PROVIDER_EMAIL=rozen@gmail.com
DEMO_PROVIDER_PASSWORD=12345
DEMO_ADMIN_EMAIL=admin@gearup.com
DEMO_ADMIN_PASSWORD=Admin123!
```
Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + the six `DEMO_*` (server-side only) in
Vercel env too.

### 2. Google button (`app/(authGroup)/_components/LoginForm.tsx` + `RegisterForm.tsx`)
- `npm i @react-oauth/google`.
- Wrap the auth layout root (`app/(authGroup)/layout.tsx`, server component
  rendering a client provider) with:
  ```tsx
  <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!}>
  ```
  Wrap once at layout level, not per-form, to avoid double provider mounts.
- Render `<GoogleLogin onSuccess={onGoogleSuccess} onError={...} />` as a
  secondary button above submit on **both** Login and Register. On Register the
  account is always created as CUSTOMER (backend decision) — documented
  tradeoff; a Google sign-up cannot choose PROVIDER.
- ⚠️ **Button placement:** `LoginForm.tsx:41` wraps the whole `Card` in
  `<form action={action}>`. The `<GoogleLogin>` button **and** the demo
  quick-login buttons must live **outside** that `<form>` element, placed
  **below** the `</Card>`. Clicking the GIS iframe/button inside a native form
  risks triggering an unintended form submit.
- `onGoogleSuccess`:
  ```ts
  const onGoogleSuccess = async (res: CredentialResponse) => {
    const idToken = res.credential
    await googleAuthAction(idToken) // server action, handles cookies + redirect
  }
  ```
- **No localStorage, no URL tokens.** The ID token goes straight from the GIS
  button to a server action.

### 3. Server action (`app/(authGroup)/_actions/authActions.ts`) — `googleAuthAction`
Translate the Google ID token through the **same server-action auth path as
`loginAction`** (single auth path, matches `proxy.ts`):
```ts
"use server"
export const googleAuthAction = async (idToken: string) => {
  const res = await fetch(`${process.env.BACKEND_API_URL}/api/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    cache: "no-cache",
  })
  const result = await res.json()
  if (!result.success) {
    // surface result.message to the form/toast; no redirect
    return { success: false, message: result.message || "Google sign-in failed" }
  }
  const { accessToken, refreshToken } = result.data
  const cookieStore = await cookies()
  cookieStore.set("accessToken", accessToken, { httpOnly: true, maxAge: 60*60*24, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
  cookieStore.set("refreshToken", refreshToken, { httpOnly: true, maxAge: 60*60*24*7, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
  cookieStore.set("accessTokenClient", accessToken, { httpOnly: false, maxAge: 60*60*24, sameSite: "lax", secure: process.env.NODE_ENV === "production" })
  const decodedToken = jwt.decode(accessToken) as JwtPayload
  if (decodedToken.role === "ADMIN") redirect("/admin-dashboard")
  else if (decodedToken.role === "PROVIDER") redirect("/provider-dashboard")
  else redirect("/customer-dashboard")
}
```
Why not a client-side `fetch` with `credentials: "include"`: the backend cookie
attributes are `sameSite: "none", secure: false`, which Chrome drops, and it
would create a second, divergent auth path. The server action reuses the exact
`loginAction` cookie logic so the proxy (`proxy.ts`) and `getMe` keep working
unchanged.
- ⚠️ **`redirect()` throws internally** (a `NEXT_REDIRECT` error) — do **not**
  wrap `googleAuthAction`'s body in `try/catch`, and do not swallow/re-catch
  the redirect. The action must end with the `redirect()` call running to
  completion.

### 4. Demo quick-login buttons (`LoginForm.tsx`)
- Section under the form: **Login as Customer / Login as Provider / Login as
  Admin** (secondary outline buttons).
- Each calls `demoLoginAction(role)` in `app/(authGroup)/_actions/authActions.ts`:
  - reads `process.env['DEMO_${ROLE}_EMAIL']` /
    `process.env['DEMO_${ROLE}_PASSWORD']` server-side (computed key — never
    inlined into the client bundle);
  - reuses `loginAction`'s logic exactly (call login API, set the three
    httpOnly/`accessTokenClient` cookies, `redirect` by `decodedToken.role`);
  - missing env → friendly error toast.
- No prefill, no hardcoded map, no secrets in the client bundle.

## Rules for implementation
- Tokens only in httpOnly cookies (Spec 01), never localStorage / URL.
- Google-verified email required before linking to an existing password
  account; newly created Google accounts get `password: null`.
- Google-only users may **set** (not change) a password via
  `PATCH /api/auth/profile` without a current password.
- Backend stays stateless — no Google token/session storage, own JWT every
  login.

## Definition of done
- [ ] Google register → login works on the deployed URL, lands on customer
      dashboard with a real session
- [ ] Google login with an email that already has a password account links
      `googleId` (tested, no dupes); re-runs reuse
- [ ] Google-only user can set a password via profile (Spec 13); afterwards
      logs in with either Google or password
- [ ] Password login attempt on a Google-only account → clean 400 (no 500)
- [ ] Login as Customer / Provider / Admin one-click buttons each land in the
      matching role's dashboard with a real session; creds come from server
      `DEMO_*` env (verified NOT in client bundle)
- [ ] No demo users/gear seeded

## Commits
- Backend:
  - `feat: add googleId and optional-password to User`
  - `feat: google oauth login (id-token flow)`
- Frontend:
  - `feat: Google sign-in button`
  - `feat: demo quick-login buttons (customer/provider/admin)`
