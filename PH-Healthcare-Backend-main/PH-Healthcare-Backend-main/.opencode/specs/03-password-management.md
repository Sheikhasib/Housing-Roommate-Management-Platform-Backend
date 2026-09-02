# Spec: Password Management

## Overview

Password flows for everyone who logs in with a password: forgot-password (OTP by email) and reset-password are implemented; change-password (logged in, current + new password) and set-password (Google-only patients choosing a password) are planned (Project Requirements §3.4, §3.5, §3.6).

## Depends on

- `prisma/schema/user.prisma` — User (`password`, `googleId`, `authProvider`, `status`, `emailVerified`)
- `src/app/module/auth/auth.service.ts` — `forgotPassword`, `resetPassword`
- `src/app/module/auth/auth.interface.ts` — `IForgotPasswordPayload`, `IResetPasswordPayload`
- `src/app/lib/redis.ts` — `redisClient` for the reset OTP
- `src/app/lib/nodemailer.ts` — `transporter` + `forgot-password.ejs`, `reset-password-success.ejs`
- `src/app/middleware/validateRequest.ts`, `src/app/middleware/checkAuth.ts`
- `src/app/config/index.ts` — `bcrypt_salt_rounds`, `smtp_user`

## Database changes

None — all fields exist.

## Routes

Implemented:
- `POST /api/v1/auth/forgot-password` — public. Body `{ email }`, validated by `AuthValidation.ForgotPasswordZodSchema`. Emails a 6-digit OTP (Redis key `forgot-password-otp:<email>`, EX 5 min). Returns `{ message: "OTP sent to Email: <email>", data: null }`.
- `POST /api/v1/auth/reset-password` — public. Body `{ email, newPassword, otp }`, validated by `AuthValidation.ResetPasswordZodSchema`. Verifies OTP, hashes and stores the new password, deletes the Redis key, emails `reset-password-success.ejs`.

Planned:
- `POST /api/v1/auth/change-password` — `auth()` (any role). Body `{ currentPassword, newPassword }`. For a user who knows their current password.
- `POST /api/v1/auth/set-password` — `auth(Role.PATIENT)`. Body `{ newPassword }`. Only for patients with `authProvider === GOOGLE` and no `password` yet.

## Service functions

```
src/app/module/auth/auth.service.ts
  forgotPassword(payload: IForgotPasswordPayload)
    - findUnique by email; 404 if missing
    - reject BLOCKED / unverified-email / deleted
    - if googleId set && authProvider !== "GOOGLE" → 409 "use Google login"
    - generate 6-digit OTP; set `forgot-password-otp:<email>` EX 5min
    - render forgot-password.ejs; send via transporter

  resetPassword(payload: IResetPasswordPayload)
    - same existence/status/google checks as forgotPassword
    - get Redis OTP; 400 if missing or mismatched
    - bcrypt.hash(newPassword, Number(config.bcrypt_salt_rounds)); prisma.user.update password
    - redisClient.del([key]); render reset-password-success.ejs; send email

  changePassword(currentPassword, newPassword)  // planned
    - verify currentPassword against user.password (bcrypt.compare); 400 on mismatch
    - hash newPassword; update user.password

  setPassword(newPassword)  // planned, patient only
    - require authProvider GOOGLE and password === null; 409 otherwise
    - hash newPassword; update user.password
```

## Validation schemas

```
src/app/module/auth/auth.validation.ts
  AuthValidation.ForgotPasswordZodSchema — { email: z.email() }
  AuthValidation.ResetPasswordZodSchema — { email, newPassword (same strength rules as register), otp: string length 6 }
  ChangePasswordZodSchema — { currentPassword, newPassword (strength rules) }  // planned
  SetPasswordZodSchema — { newPassword (strength rules) }  // planned
```

## Files to change

Planned additions go in `src/app/module/auth/auth.service.ts`, `auth.controller.ts`, `auth.route.ts`, `auth.validation.ts`, `auth.interface.ts`.

## Files to create

None.

## New dependencies

No new dependencies.

## Rules for implementation

- The Google-account guard (`googleId && authProvider !== "GOOGLE"`) applies to forgot/reset — a Google-registered patient must not receive a reset OTP
- Email lowercased/trimmed before lookups; Redis keys namespaced `forgot-password-otp:<email>`
- Password strength rules must match `PatientRegisterZodSchema` (min 4, max 32, uppercase/lowercase/digit/special)
- Never return `password`; errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`
- Forgot-password endpoint must not leak account existence beyond the success message (keep current behavior)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `POST /api/v1/auth/forgot-password` emails a working OTP; unknown email → 404
- `POST /api/v1/auth/reset-password` with the OTP updates the password and sends the success email; wrong OTP → 400
- Login with the new password succeeds; login with the old password fails
- (planned) change-password requires the correct current password
- (planned) set-password only works for a Google patient with no password
