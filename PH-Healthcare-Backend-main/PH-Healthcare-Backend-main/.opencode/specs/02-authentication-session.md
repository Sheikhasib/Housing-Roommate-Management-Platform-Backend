# Spec: Authentication Session

## Overview

Signed-in session management for every role: credential login, Google login, current-user profile fetch, and access/refresh token rotation (Project Requirements §3.3, §3.7). Login is shared across roles; Google login is patient-only. All login flows issue an access token + refresh token returned in the JSON body.

## Depends on

- `prisma/schema/user.prisma` — User (`password` nullable, `googleId`, `authProvider`, `role`, `status`)
- `prisma/schema/patient.prisma` — Patient
- `src/app/module/auth/auth.service.ts` — `loginUser`, `googleLogin`, `getMe`, `refreshToken`
- `src/app/lib/googleAuth.ts` — `googleClient` (OAuth2Client)
- `src/app/utils/jwt.ts` — `jwtUtils.createToken` / `verifyToken`
- `src/app/middleware/checkAuth.ts` — `auth(...roles)` guard, `req.user`
- `src/app/config/index.ts` — JWT secrets/expiries, `google_client_id`

## Database changes

None.

## Routes

- `POST /api/v1/auth/login` — public. Body `{ email, password }`, validated by `AuthValidation.LoginZodSchema`. Returns `{ accessToken, refreshToken }`.
- `POST /api/v1/auth/google` — public. Body `{ idToken }`. Verifies the Google ID token, links or creates a PATIENT, returns `{ accessToken, refreshToken }`.
- `GET /api/v1/auth/me` — `auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN)`. Returns the current user (with `patient` relation, `password` omitted).
- `POST /api/v1/auth/refresh-token` — public, reads `req.cookies.refreshToken`. Rotates both tokens and returns them.

## Service functions

```
src/app/module/auth/auth.service.ts
  loginUser(payload: ILoginUserPayload)
    - findUnique by email → 404 if missing
    - reject BLOCKED / deleted
    - if user.password === null || user.googleId !== null → 409 "use Google login"
    - bcrypt.compare; 401 on mismatch
    - sign access + refresh tokens; return both

  googleLogin(payload: IGoogleLoginPayload)
    - googleClient.verifyIdToken({ idToken, audience: config.google_client_id })
    - 401 on invalid/expired token; 400 if no name/email in payload
    - existing patient (email+role+googleId) → reuse
    - credential patient with same email → update googleId (reject unverified/blocked/deleted)
    - otherwise create PATIENT (authProvider GOOGLE, emailVerified true) + patient profile + welcome email
    - reject BLOCKED / deleted; sign tokens; return both

  getMe(user: IRequestUser)
    - prisma.user.findUnique({ where: { id: user.userId }, include: { patient: true }, omit: { password: true } })
    - 404 if missing; return the user

  refreshToken(token: string)
    - jwtUtils.verifyToken(token, config.jwt_refresh_secret); 401 if invalid
    - reload user; reject if missing / isDeleted / status !== ACTIVE
    - sign new access + refresh; return both
```

## Validation schemas

```
src/app/module/auth/auth.validation.ts
  AuthValidation.LoginZodSchema
    - email: z.email()
    - password: min 4 max 32 + uppercase/lowercase/digit/special
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies.

## Rules for implementation

- Tokens returned in the JSON body are the source of truth (cookies are set but unreliable — README known limitation; never depend on them for clients)
- JWT payload shape is always `{ userId, name, email, role }`
- `config.node_env === "development"` may expose the raw verify error in refresh-token messages; production returns a generic message
- Google login only ever creates PATIENT — do not allow Google auth for doctors/admins/super admins
- Never return `password` on any user read
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `POST /api/v1/auth/login` returns access + refresh tokens for a verified patient; wrong password → 401; blocked user → 403
- `GET /api/v1/auth/me` with `Authorization: Bearer <accessToken>` returns the profile; no token → 401
- `POST /api/v1/auth/refresh-token` (refreshToken cookie) returns a fresh token pair
- `POST /api/v1/auth/google` with a valid Google ID token creates/logs in a patient
