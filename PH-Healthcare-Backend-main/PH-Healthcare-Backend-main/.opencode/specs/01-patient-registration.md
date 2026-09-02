# Spec: Patient Registration

## Overview

A patient creates an account with `name`, `email`, and `password`. The account is not usable until the patient verifies their email with a 6-digit OTP emailed to them (Project Requirements §3.1, §3.2). On verification the user + patient rows are created in one nested Prisma call, tokens are issued, and a welcome email goes out (§3.8). Registration is patient-only — no role can be supplied in the body.

## Depends on

- `prisma/schema/user.prisma` — User (role defaults PATIENT, `emailVerified`, `status`, `password`)
- `prisma/schema/patient.prisma` — Patient (1-to-1 with User)
- `prisma/schema/enums.prisma` — `Role`, `UserStatus`, `AuthProvider`
- `src/app/module/auth/auth.service.ts` — `registerPatient`, `verifyPatientEmail`
- `src/app/lib/prisma.ts` — shared client
- `src/app/lib/redis.ts` — `redisClient` for OTP + pending registration payload
- `src/app/lib/nodemailer.ts` — `transporter` + EJS templates
- `src/app/middleware/validateRequest.ts` — Zod validation middleware
- `src/app/config/index.ts` — `config.bcrypt_salt_rounds`, `config.smtp_user`

## Database changes

None — both models already exist.

## Routes

- `POST /api/v1/auth/register` — public. Body: `{ name, email, password, patient?: { contactNumber? } }`. Validated by `AuthValidation.PatientRegisterZodSchema`. Stores OTP + hashed-password payload in Redis (5 min TTL), emails the OTP. Returns 201 `{ success, message: "Verification OTP sent successfully", data: null }`. Never creates the user here.
- `POST /api/v1/auth/verify-email` — public. Body: `{ email, otp }`. Validated by `AuthValidation.verifyPatientZodSchema`. On success creates User + Patient, sets `emailVerified: true`, deletes the Redis keys, sends the welcome email, returns `{ accessToken, refreshToken, user, patient }`.

## Service functions

```
src/app/module/auth/auth.service.ts
  registerPatient(payload: IRegisterPatientPayload)
    - findUnique user by email → throw CONFLICT if exists
    - bcrypt.hash(password, Number(config.bcrypt_salt_rounds))
    - redisClient.set `patient-registration-otp:<email>` = 6-digit OTP, EX 5min
    - redisClient.set `patient-registration-data:<email>` = JSON.stringify({name,email,password:hashed,patient}), EX 5min
    - render src/app/templates/registration-user-otp.ejs, transporter.sendMail
    - returns undefined (no DB write yet)

  verifyPatientEmail(payload: IVerifyEmailPayload)
    - look up user by email; reject BLOCKED / already-verified / deleted
    - compare Redis OTP; delete `patient-registration-otp:<email>` after match
    - read `patient-registration-data:<email>`, delete it
    - prisma.user.create with nested patient.create (contactNumber defaults ""),
      role Role.PATIENT, status ACTIVE, emailVerified true, omit password, include patient
    - render patient-welcome-email.ejs and send
    - sign access + refresh tokens (jwtUtils.createToken with config secrets/expiry)
    - returns { user, patient, accessToken, refreshToken }
```

## Validation schemas

```
src/app/module/auth/auth.validation.ts
  AuthValidation.PatientRegisterZodSchema
    - name: string min 3 max 15
    - email: z.email()
    - password: min 4 max 32 + must contain uppercase, lowercase, digit, special char
    - patient: optional object with optional contactNumber
  AuthValidation.verifyPatientZodSchema
    - email: z.email()
    - otp: string length 6
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies.

## Rules for implementation

- Email keys are lowercased/trimmed: `payload.email.trim().toLowerCase()`
- Every Redis OTP write uses `{ expiration: { type: "EX", value } }`
- Never return `password` — `omit: { password: true }` on all user reads
- Never spread `req.body` into Prisma `create` — build the data object field by field
- Errors via `throw new AppError(httpStatus.CODE, "message")`, handlers wrapped in `catchAsync`, responses via `sendResponse`
- OTP expiry 5 minutes (`5 * 60` seconds) — constants inline, matching existing code
- Use `config.bcrypt_salt_rounds` for the hash cost (the README notes it is currently hardcoded — read it from config)

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `POST /api/v1/auth/register` with a fresh email returns 201 and an OTP email arrives
- Re-registering the same email returns 409
- `POST /api/v1/auth/verify-email` with the correct OTP creates the user + patient and returns access + refresh tokens
- Wrong/expired OTP returns 400; already-verified email returns 409
- `GET /api/v1/auth/me` with the returned access token returns the patient profile
- Welcome email is received after verification
