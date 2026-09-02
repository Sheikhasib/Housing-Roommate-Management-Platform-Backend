# Spec: User Profile

## Overview

Profile management for any signed-in user. Profile image upload is implemented (multer → Cloudinary → `User.imageUrl`/`imagePublicId`, deleting the previous image). A richer patient profile update (contact details + medical info) is planned per Project Requirements §11 ("Patient profile — personal info plus medical info").

## Depends on

- `prisma/schema/user.prisma` — User (`imageUrl`, `imagePublicId`)
- `prisma/schema/patient.prisma` — Patient (`contactNumber`, `address`, `isDeleted`)
- `src/app/module/user/user.service.ts` — `uploadProfileImage`
- `src/app/lib/multer.ts` — `upload.single("profileImage")`
- `src/app/lib/cloudinary.ts` — `cloudinary.uploader.upload_stream`, `destroy`
- `src/app/middleware/checkAuth.ts` — `auth(Role.ADMIN, Role.DOCTOR, Role.PATIENT, Role.SUPER_ADMIN)`

## Database changes

Planned (patient medical info per §11) — e.g. add to `prisma/schema/patient.prisma`:
```
  bloodGroup String?   // optional medical info
  dateOfBirth DateTime?
  emergencyContact String?
```
Only if the product owner confirms the exact fields — otherwise keep to what §11 lists (personal info plus medical info) and run `npx prisma migrate dev` + `npx prisma generate` after any change.

## Routes

- `PATCH /api/v1/user/profile-image` — `auth(ADMIN, DOCTOR, PATIENT, SUPER_ADMIN)`. Multipart `profileImage`. Returns the updated user (`password` omitted).

Planned:
- `PATCH /api/v1/patient/profile` — `auth(Role.PATIENT)`. Body `{ contactNumber?, address?, bloodGroup?, dateOfBirth?, emergencyContact? }`. Updates the Patient profile.

## Service functions

```
src/app/module/user/user.service.ts
  uploadProfileImage(buffer: Buffer, userId: string)
    - read current imageUrl/imagePublicId for the user
    - cloudinary.uploader.upload_stream (resource_type: auto) → reject with AppError(502) on failure/no result
    - prisma.user.update { imageUrl: secure_url, imagePublicId: public_id }, omit password
    - if a previous image exists → cloudinary.uploader.destroy(old publicId)
    - return the updated user

  updatePatientProfile(payload, user)  // planned
    - resolve patient by { userId } → 404 if missing
    - prisma.patient.update with destructured payload
    - return updated patient
```

## Validation schemas

```
src/app/module/user/user.validation.ts  // planned
  UpdatePatientProfileValidationZodSchema
    - contactNumber? min 5, address? min 5, bloodGroup? enum, dateOfBirth? z.coerce.date(), emergencyContact? min 5
```

## Files to change

`src/app/module/user/user.service.ts`, `user.controller.ts`, `user.route.ts` for the planned patient profile endpoint (add `patient.validation.ts`).

## Files to create

`src/app/module/user/user.validation.ts` (planned).

## New dependencies

No new dependencies.

## Rules for implementation

- Multer is memory storage — pass `req.file.buffer` to Cloudinary; 400 if no file
- Always destroy the previous Cloudinary image after the new upload succeeds (avoid orphaned assets)
- Never return `password` — `omit: { password: true }`
- Planned patient profile update must destructure exact fields, never spread `req.body` into Prisma
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- `PATCH /profile-image` with a file returns the user with a new `imageUrl`; no file → 400; re-upload deletes the old image
- (planned) `PATCH /patient/profile` updates contact + medical fields and returns the patient
- (planned) invalid field types rejected by the Zod schema
