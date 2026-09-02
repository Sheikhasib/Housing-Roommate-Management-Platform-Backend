# Spec: Admin Management

## Overview

Platform administration for Admin and Super Admin roles: creating new Admin accounts (invite + generated password + forced password change + welcome email to the personal inbox) and blocking/unblocking users. Super Admin can create Super Admins and block other Admins/Super Admins; Admin cannot (Project Requirements §4, §2.1). This is a **planned** feature — no `admin` module exists yet.

## Depends on

- `prisma/schema/user.prisma` — User (`role`, `status`, `needPasswordChange`, `emailVerified`)
- `prisma/schema/enums.prisma` — `Role`, `UserStatus`
- `src/app/lib/prisma.ts`, `src/app/lib/nodemailer.ts` (EJS templates in `src/app/templates/`)
- `src/app/utils/jwt.ts` — tokens not needed here (no self-registration)
- `src/app/middleware/checkAuth.ts` — `auth(Role.ADMIN, Role.SUPER_ADMIN)` / `auth(Role.SUPER_ADMIN)`
- `src/app/config/index.ts` — `bcrypt_salt_rounds`, `smtp_user`, `email_sender`
- Bootstrapped admin accounts come from `src/app/utils/seed.ts` (`seedSuperAdmin`, `seedTesterAdmin`)

## Database changes

None — `Role`, `UserStatus`, `needPasswordChange`, `emailVerified` all exist. New Admin/Super Admin accounts are just `User` rows with no profile relation.

## Routes

- `POST /api/v1/admin/create-admin` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Body `{ name, organizationEmail, personalEmail, role? }`. Only `Role.SUPER_ADMIN` may pass `role: "SUPER_ADMIN"` (403 otherwise). Generates a password, creates the user with `emailVerified: true`, `needPasswordChange: true`, emails the personal inbox with the organization email + generated password + change-password prompt.
- `PATCH /api/v1/admin/block-unblock/:userId` — role-scoped per §2.1. Body `{ isBlocked: boolean }` → `User.status = BLOCKED | ACTIVE`.
- `GET /api/v1/admin/users` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. List users by role (DOCTOR/PATIENT/ADMIN) with `IQuery` pagination + search.

## Service functions

```
src/app/module/admin/admin.service.ts
  createAdmin(payload: ICreateAdminPayload, creator: RequestUser)
    - validate creator role: only SUPER_ADMIN may target SUPER_ADMIN
    - reject if organizationEmail already exists (409)
    - generate password (crypto random, e.g. Math.random().toString(36) or crypto.randomBytes)
    - prisma.user.create { name, email: organizationEmail, password: hashed, role, emailVerified: true, needPasswordChange: true }
    - render a welcome EJS template (create `src/app/templates/admin-welcome-email.ejs`),
      to: personalEmail, body: organization email + generated password + change-password prompt
    - return the user (omit password)

  blockUnblockUser(userId, isBlocked, actor: RequestUser)
    - load target user; 404 if missing
    - per §2.1: if target is ADMIN/SUPER_ADMIN → actor must be SUPER_ADMIN (403 otherwise)
    - prisma.user.update { status: isBlocked ? UserStatus.BLOCKED : UserStatus.ACTIVE }

  getAllUsers(query: IQuery)  // planned
    - filter by role, searchTerm (name/email), pagination; omit password
```

## Validation schemas

```
src/app/module/admin/admin.validation.ts
  CreateAdminValidationZodSchema
    - name: z.string().trim().min(3)
    - organizationEmail: z.email()
    - personalEmail: z.email()
    - role: z.enum(["ADMIN", "SUPER_ADMIN"]).default("ADMIN")
  BlockUnblockUserValidationZodSchema — { isBlocked: z.boolean() }
```

## Files to change

- `src/app.ts` — mount the router: `app.use("/api/v1/admin", AdminRoutes)`

## Files to create

- `src/app/module/admin/admin.route.ts`
- `src/app/module/admin/admin.controller.ts`
- `src/app/module/admin/admin.service.ts`
- `src/app/module/admin/admin.interface.ts`
- `src/app/module/admin/admin.validation.ts`
- `src/app/templates/admin-welcome-email.ejs`

## New dependencies

No new dependencies.

## Rules for implementation

- Admins never self-register and never go through OTP — the invite + generated password + forced change flow (§4) is the security model
- Permission matrix (§2.1): Admin may create Admin and block/unblock Doctor/Patient; only Super Admin may create Super Admin or block/unblock Admin/Super Admin
- Organization email is the login identity; the personal email is only used to deliver the welcome message
- Store a hashed password (bcrypt with `config.bcrypt_salt_rounds`); never return it
- Set `needPasswordChange: true` on every created Admin/Super Admin
- Use `src/app/utils/seed.ts` as the reference for how admin users are shaped today
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Admin creates an Admin → welcome email reaches the personal inbox with organization email + generated password; new user must change password on first login
- Admin attempting to create a Super Admin → 403; Super Admin succeeds
- Super Admin blocks/unblocks an Admin; Admin attempting the same → 403
- Admin blocks/unblocks a Doctor/Patient and the change takes effect on their next auth
