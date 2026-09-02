import { UploadApiResponse } from "cloudinary";
import httpStatus from "http-status";
import PDFDocument from "pdfkit";
import { AppointmentStatus, Role } from "../../../generated/prisma/enums";
import config from "../../config";
import { cloudinary } from "../../lib/cloudinary";
import { transporter } from "../../lib/nodemailer";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import { ICreatePrescriptionPayload } from "./prescription.interface";

// Create Prescription By Doctor
const createPrescription = async (
  payload: ICreatePrescriptionPayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  // check if the appointment belongs to the doctor
  const appointment = await prisma.appointment.findUnique({
    where: { id: payload.appointmentId, doctorId: doctor.id },
    include: { patient: true },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
  }

  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Prescription Can Only Be Written For A Completed Appointment",
    );
  }

  if (appointment.prescriptionUrl) {
    throw new AppError(
      httpStatus.CONFLICT,
      "A Prescription Already Exists For This Appointment",
    );
  }

  // Create PDF for Prescription
  const pdfDocument = new PDFDocument({ margin: 50 });

  const pdfChunks: Buffer[] = [];

  pdfDocument.on("data", (chunk: Buffer) => {
    pdfChunks.push(chunk);
  });

  const pdfReadyPromise = new Promise<Buffer>((resolve) => {
    pdfDocument.on("end", () => {
      resolve(Buffer.concat(pdfChunks));
    });
  });

  //pdf contents

  pdfDocument.fontSize(20).text("PH Healthcare System", { align: "center" });
  pdfDocument.fontSize(14).text("Prescription", { align: "center" });
  pdfDocument.moveDown(2);

  pdfDocument.fontSize(12).text(`Patient Name: ${appointment.patient.name}`);
  pdfDocument.text(`Doctor Name: ${doctor.name}`);
  pdfDocument.text(`Specialization: ${doctor.specialization}`);
  pdfDocument.text(`Date: ${new Date().toDateString()}`);
  pdfDocument.moveDown();

  pdfDocument.fontSize(14).text("Findings");
  pdfDocument.fontSize(12).text(payload.findings);
  pdfDocument.moveDown();

  pdfDocument.fontSize(14).text("Medicines");
  pdfDocument.moveDown(0.5);

  // Add medicines to pdf document
  for (let i = 0; i < payload.medicines.length; i++) {
    const medicine = payload.medicines[i];

    pdfDocument.fontSize(12).text(`${i + 1}. ${medicine.name}`);
    pdfDocument.text(`   Dosage: ${medicine.dosage}`);
    pdfDocument.text(`   Duration: ${medicine.duration}`);

    if (medicine.instructions) {
      pdfDocument.text(`   Instructions: ${medicine.instructions}`);
    }

    pdfDocument.moveDown(0.5);
  }

  // end pdf document
  pdfDocument.end();

  // wait for pdf to be ready(converted to buffer)
  const pdfBuffer = await pdfReadyPromise;

  // upload to cloudinary
  const uploadResult = await new Promise<UploadApiResponse>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          { resource_type: "raw", format: "pdf" },
          (error, result) => {
            if (error) {
              return reject(error);
            }

            if (!result) {
              return reject(
                new AppError(
                  httpStatus.INTERNAL_SERVER_ERROR,
                  "No Result Returned From Cloudinary",
                ),
              );
            }

            resolve(result);
          },
        )
        .end(pdfBuffer);
    },
  );

  // update appointment with prescription into DB
  const updatedAppointment = await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      prescriptionUrl: uploadResult.secure_url,
      prescriptionPublicId: uploadResult.public_id,
    },
  });

  // send email to patient with prescription
  await transporter.sendMail({
    from: config.email_sender,
    to: appointment.patient.email,
    subject: "Your Prescription - PH Healthcare System",
    text: "Please find your prescription attached.",
    attachments: [
      {
        filename: "prescription.pdf",
        content: pdfBuffer,
      },
    ],
  });

  return updatedAppointment;
};

// Get Single Prescription
const getSinglePrescription = async (
  appointmentId: string,
  user: RequestUser,
) => {
  // check if the appointment exists with given id or not
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { id: true, name: true, userId: true } },
      doctor: { select: { id: true, name: true, userId: true } },
    },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
  }

  // check if the user is a patient or not
  if (user.role === Role.PATIENT) {
    // check if the appointment belongs to the logged in patient
    if (appointment.patient.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You Are Not Allowed To View This Appointment",
      );
    }
  }

  // check if the user is a doctor or not
  if (user.role === Role.DOCTOR) {
    // check if the appointment belongs to the logged in doctor
    if (appointment.doctor.userId !== user.userId) {
      throw new AppError(
        httpStatus.FORBIDDEN,
        "You Are Not Allowed To View This Appointment",
      );
    }
  }

  // check if the appointment has a prescription or not
  if (!appointment.prescriptionUrl) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "No Prescription Has Been Written Yet",
    );
  }

  return {
    appointment,
    prescription: appointment.prescriptionUrl,
  };
};

export const PrescriptionServices = {
  createPrescription,
  getSinglePrescription,
};
