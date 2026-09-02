# Spec: Doctor Application

## Overview

A prospective doctor applies through a public endpoint, uploading a resume (required) and additional files (optional). Applying creates a DOCTOR user + Doctor profile (verification `PENDING`), emails an OTP the applicant must verify, and an Admin/Super Admin later approves or rejects the application. Approval flips verification to `APPROVED` and emails a welcome; rejection requires a reason and emails a notice (Project Requirements §5, §3.8). A cron job purges applications older than 1 hour whose email was never verified.

## Depends on

- `prisma/schema/user.prisma` — User (`role`, `emailVerified`, `needPasswordChange`)
- `prisma/schema/doctor.prisma` — Doctor (`verificationStatus`, `resume`, `resumePublicId`, `additionalFiles Json`, `reviewedBy`, `reviewAt`)
- `prisma/schema/enums.prisma` — `Role`, `DoctorVerificationStatus`
- `src/app/module/doctor/doctor.service.ts` — `applyAsDoctor`, `verifyDoctorEmail`, `approveDoctor`
- `src/app/module/doctor/doctor.interface.ts` — payload types
- `src/app/lib/cloudinary.ts`, `src/app/lib/multer.ts` — resume/additional file uploads
- `src/app/lib/redis.ts` — OTP key `doctor-application-otp:<email>` (EX 1h)
- `src/app/lib/nodemailer.ts` — `transporter` + `registration-user-otp.ejs`, `doctor-application-approved.ejs`, `doctor-application-rejected.ejs`
- `src/app/lib/cron.ts` — `deleteUnverifiedDoctors` (every 10 min, deletes DOCTOR users with `emailVerified: false`, `createdAt < now-1h`, doctor `verificationStatus: PENDING`)
- `src/app/middleware/checkAuth.ts` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`

## Database changes

None — all fields exist. (Note: `reviewAt` is a `String?` column though the service writes `reviewedAt: new Date()` — confirm the field name when touching this code.)

## Routes

- `POST /api/v1/doctor/apply-as-doctor` — public. Multipart/form-data: `resume` (maxCount 1, required), `additionalFiles` (maxCount 10, optional), `data` = JSON string validated by `ApplyAsDoctorValidationZodSchema`. Creates user+doctor, uploads files to Cloudinary, sends OTP email. Returns 200 `"Doctor application submitted successfully"`.
- `POST /api/v1/doctor/verify-doctor-email` — public. Body `{ email, otp }`. Sets `emailVerified: true`, returns the verified user with doctor relation.
- `POST /api/v1/doctor/approve-doctor` — `auth(Role.ADMIN, Role.SUPER_ADMIN)`. Body `{ doctorId, verificationStatus, rejectionReason? }`. Emails the doctor and updates `verificationStatus` (+ `reviewedBy`, `reviewedAt`).

## Service functions

```
src/app/module/doctor/doctor.service.ts
  applyAsDoctor(payload: IApplyAsDoctorPayload, resume, additionalFiles)
    - reject if user already exists with the email (CONFLICT)
    - upload resume + additionalFiles to Cloudinary (upload_stream), keep secure_url + public_id
    - generate a random doctor password (Math.random().toString(36).slice(-8)), bcrypt.hash with config.bcrypt_salt_rounds
    - prisma.user.create with role DOCTOR, needPasswordChange true, nested doctor.create
    - set `doctor-application-otp:<email>` in Redis, EX 60*60 (1h)
    - render registration-user-otp.ejs and email the OTP

  verifyDoctorEmail(payload: IVerifyDoctorEmailPayload)
    - findUnique user by { email, role: DOCTOR }; 404 if missing
    - 409 if already emailVerified
    - compare Redis OTP; 400 if expired or mismatched
    - prisma.user.update emailVerified: true, omit password, include doctor

  approveDoctor(payload: IApproveDoctorPayload, reviewer: RequestUser)
    - findUnique doctor by id (include user); 404 if missing/deleted
    - 400 if user.emailVerified is false
    - 409 unless verificationStatus is PENDING
    - 400 if REJECTED && no rejectionReason
    - prisma.doctor.update { verificationStatus, rejectionReason (null unless REJECTED), reviewedBy: reviewer.userId, reviewedAt: new Date() }
    - render approved/rejected EJS template and email the doctor
```

## Validation schemas

```
src/app/module/doctor/doctor.validation.ts
  ApplyAsDoctorValidationZodSchema
    - user: { name min 2, email z.email() trimmed lowercased }
    - doctor: { address? min 5, specialization min 2, licenseNumber min 3, qualifications min 2,
                experienceYears: z.number().int().min(0), bio? max 1000, consultationFee? z.number().min(0), contactNumber? min 5 }
    - used with JSON.parse(req.body.data) because multer sends the body as a string
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies.

## Rules for implementation

- Multer body fields arrive as strings — parse `req.body.data` with `JSON.parse` before Zod validation
- Store `secure_url` + `public_id` for resume; `additionalFiles` stored as `[{ url, publicId }]`
- Doctor accounts start `needPasswordChange: true` and get a generated password
- `approve-doctor` is Admin/Super Admin only (§2.1); the reviewer identity comes from `req.user`
- Cron deletes only never-verified DOCTOR users (`emailVerified: false`) whose Doctor application is still PENDING and older than 1 hour
- Never return `password`; errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `POST /api/v1/doctor/apply-as-doctor` with resume upload creates a PENDING doctor + user and emails an OTP
- `POST /api/v1/doctor/verify-doctor-email` with the OTP verifies the email
- `POST /api/v1/doctor/approve-doctor` as admin approves and emails; rejection without a reason → 400
- An unverified doctor application older than 1 hour is removed by the cron job
