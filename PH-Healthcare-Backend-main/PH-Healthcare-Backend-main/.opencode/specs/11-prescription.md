# Spec: Prescription

## Overview

After an appointment is COMPLETED, the doctor writes a prescription for it: key findings plus a list of prescribed medicines. The system generates a PDF, uploads it to Cloudinary (storing `prescriptionUrl`/`prescriptionPublicId` on the appointment), and emails it to the patient. A prescription cannot be written for an appointment that isn't completed, and only one prescription per appointment. Patients/doctors/admins can fetch the prescription for an appointment (ownership-checked) (Project Requirements §9).

## Depends on

- `prisma/schema/appointment.prisma` — Appointment (`status`, `prescriptionUrl`, `prescriptionPublicId`)
- `prisma/schema/doctor.prisma`, `prisma/schema/patient.prisma` — relations
- `prisma/schema/enums.prisma` — `AppointmentStatus`, `Role`
- `src/app/module/prescription/prescription.service.ts` — `createPrescription`, `getSinglePrescription`
- `src/app/module/prescription/prescription.interface.ts` — `ICreatePrescriptionPayload`, `IMedicine`
- `src/app/lib/cloudinary.ts` — upload `resource_type: "raw", format: "pdf"`
- `src/app/lib/nodemailer.ts` — `transporter`; `pdfkit` for PDF generation
- `src/app/middleware/checkAuth.ts` — `auth(Role.DOCTOR)`, `auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN)`
- `src/app/config/index.ts` — `email_sender`

## Database changes

None — `prescriptionUrl`/`prescriptionPublicId` already exist on Appointment.

## Routes

- `POST /api/v1/prescription/create-prescription` — `auth(Role.DOCTOR)`. Body `{ appointmentId, findings, medicines: [{ name, dosage, duration, instructions? }] }` (validated by `CreatePrescriptionValidationZodSchema`). Returns 201.
- `GET /api/v1/prescription/:appointmentId` — `auth(Role.PATIENT, Role.DOCTOR, Role.ADMIN, Role.SUPER_ADMIN)`. Returns `{ appointment, prescription: prescriptionUrl }`.

## Service functions

```
src/app/module/prescription/prescription.service.ts
  createPrescription(payload: ICreatePrescriptionPayload, user)
    - resolve doctor by { userId }; 404 if missing
    - findUnique appointment by { id, doctorId: doctor.id } (include patient); 404 if missing
    - reject unless status === COMPLETED (400)
    - reject if prescriptionUrl already set (409)
    - build PDF via pdfkit: header, patient/doctor info, findings, numbered medicines with dosage/duration/instructions
    - upload buffer to Cloudinary ({ resource_type: "raw", format: "pdf" }); 500 if no result
    - prisma.appointment.update { prescriptionUrl, prescriptionPublicId }
    - transporter.sendMail to patient.email with prescription.pdf attachment

  getSinglePrescription(appointmentId, user)
    - findUnique appointment (include patient/doctor userId for ownership); 404 if missing
    - PATIENT must match appointment.patient.userId; DOCTOR must match appointment.doctor.userId (403 otherwise)
    - 404 if no prescriptionUrl yet
    - return { appointment, prescription: appointment.prescriptionUrl }
```

## Validation schemas

```
src/app/module/prescription/prescription.validation.ts
  CreatePrescriptionValidationZodSchema
    - appointmentId: z.string().min(1)
    - findings: z.string().trim().min(5)
    - medicines: array of { name min 1, dosage min 1, duration min 1, instructions? } with at least 1 item
```

## Files to change

None — module already implemented.

## Files to create

None — module already implemented.

## New dependencies

No new dependencies. (`pdfkit` and `cloudinary` already installed.)

## Rules for implementation

- Doctor must own the appointment and the appointment must be COMPLETED — these are the two hard gates
- One prescription per appointment (409 when `prescriptionUrl` is already set)
- PDF uploads use `resource_type: "raw"` with `format: "pdf"` so Cloudinary serves them as documents
- Store both `secure_url` and `public_id` on the appointment
- Email the PDF to the patient as an attachment after the DB update succeeds
- Ownership checks on fetch mirror the appointment single-view rule
- Errors via `AppError`, handlers in `catchAsync`, responses via `sendResponse`

## Definition of done

Each item verifiable with `npm run dev` + curl:
- Prescription creation on a COMPLETED appointment owned by the doctor succeeds, stores the URL, and emails the patient
- Non-completed appointment → 400; foreign appointment → 404; duplicate prescription → 409
- `GET /:appointmentId` returns the prescription URL to the patient, owning doctor, and admins; foreign patient/doctor → 403; no prescription → 404
