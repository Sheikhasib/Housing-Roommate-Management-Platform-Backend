import {
  AppointmentStatus,
  PaymentStatus,
  Role,
  ScheduleStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import httpStatus from "http-status";
import { getBkashIdToken } from "../../lib/bKash";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { RequestUser } from "../../middleware/checkAuth";
import { addMinutes, isBefore, isSameDay, subHours } from "date-fns";
import {
  IBookAppointmentPayload,
  ICancelAppointmentPayload,
  IPayAppointmentPayload,
  IUpdateAppointmentStatusPayload,
} from "./appointment.interface";
import { transporter } from "../../lib/nodemailer";
import PDFDocument from "pdfkit";
import { IQuery } from "../../interfaces";
import { AppointmentWhereInput } from "../../../generated/prisma/models";

// Book Appointment
const bookAppointment = async (
  payload: IBookAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    // business logic

    const patient = await prisma.patient.findUnique({
      where: { userId: user.userId },
    });

    if (!patient) {
      throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
    }

    const schedule = await prisma.schedule.findUnique({
      where: { id: payload.scheduleId },
      include: { doctor: true },
    });

    if (!schedule || schedule.isDeleted) {
      throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
    }

    if (schedule.status !== ScheduleStatus.PUBLISHED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "This Schedule Is Not Published Yet",
      );
    }

    const now = new Date();

    // check if schedule is available today or not, if not then throw error
    if (!isSameDay(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "This Schedule Is Not Available Today",
      );
    }

    // check if schedule is started before now or not, if not then throw error
    if (!isBefore(now, schedule.startDateTime)) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "This Schedule Has Already Started",
      );
    }

    // if(isAfter(now, schedule.startDateTime)){
    // 	throw new AppError(
    // 		httpStatus.BAD_REQUEST,
    // 		"This Schedule Has Already Started",
    // 	);
    // }

    // check if patient has already have a appointment on this schedule
    const existingAppointment = await prisma.appointment.findFirst({
      where: {
        patientId: patient.id,
        scheduleId: schedule.id,
        // status : { not : AppointmentStatus.CANCELLED }
      },
    });

    if (existingAppointment?.status === AppointmentStatus.PENDING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You Already Have A Pending Appointment. Please Pay For That",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.CONFIRMED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You Already Have A Confirmed Appointment.",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.ONGOING) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You Already Have A Ongoing Appointment",
      );
    }
    if (existingAppointment?.status === AppointmentStatus.COMPLETED) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "You Already Have Completed An Appointment On This Schedule. Please Try Again Another Day",
      );
    }

    // check if schedule is fully booked
    if (schedule.availableSlots === 0) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "This Schedule Is Fully Booked",
      );
    }

    // check if doctor has set a consultation fee yet
    if (!schedule.doctor.consultationFee) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Doctor Has Not Set A Consultation Fee Yet",
      );
    }

    // get consultation fee
    const amount = schedule.doctor.consultationFee.toString();

    // 1. create an appointment
    const appiotment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
        patientId: patient.id,
        doctorId: schedule.doctor.id,
        scheduleId: schedule.id,
      },
    });

    // 2. create bKash payment
    const bKashIdToken = await getBkashIdToken();

    if (!bKashIdToken) {
      throw new AppError(
        httpStatus.INTERNAL_SERVER_ERROR,
        "bKash id token not found",
      );
    }

    console.log(bKashIdToken);

    const bKashCreatePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${bKashIdToken}`,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          // agreementID: "TokenizedMerchant01L3IKB6H1565072174986", // appointment id
          mode: "0011",
          // payerReference: "01723888888", // user phone or email
          payerReference: user.email, // logged in user phone or email
          callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // payment callback url
          // merchantAssociationInfo: "MI05MID54RF09123456One",
          amount: amount,
          currency: "BDT",
          intent: "sale",
          // merchantInvoiceNumber: "Inv-01", // appointment id
          merchantInvoiceNumber: appiotment.id, // appointment id
        }),
      },
    );

    // get the response status and status text
    console.log(
      "bKash create payment status:",
      bKashCreatePaymentResponse.status,
      bKashCreatePaymentResponse.statusText,
    );

    // get the response json data and log it
    const bKashCreatePaymentResult = await bKashCreatePaymentResponse.json();

    console.log({ bKashCreatePaymentResult });

    // check if the response is ok or not, if not, throw an error
    if (!bKashCreatePaymentResponse.ok) {
      console.error("bKash create payment failed:", bKashCreatePaymentResult);
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        bKashCreatePaymentResult.statusMessage ||
          "Failed to create bKash payment",
      );
    }

    // 3. Payment Model Create
    await tx.payment.create({
      data: {
        // status: bKashCreatePaymentResult.status,
        // amount: bKashCreatePaymentResult.amount,
        amount: amount,
        // currency: bKashCreatePaymentResult.currency,
        // paymentGateway: bKashCreatePaymentResult.gateway,
        merchantInvoiceNumber: bKashCreatePaymentResult.merchantInvoiceNumber,
        bKashPaymentId: bKashCreatePaymentResult.paymentID,
        // bKashTrxId: bKashCreatePaymentResult.trxID,
        payerReference: user.email,
        // paidAt: bKashCreatePaymentResult.paidAt,
        gatwayResponse: bKashCreatePaymentResult,
        appointmentId: appiotment.id,
      },
    });

    return {
      paymentUrl: bKashCreatePaymentResult.bkashURL,
    };
  });

  return transactionResult;
};

// Pay for the pending Appointment
const payAppoinment = async (
  payload: IPayAppointmentPayload,
  user: RequestUser,
) => {
  const appointmentId = payload.appointmentId;

  const existingAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      schedule: {
        include: {
          doctor: true,
        },
      },
    },
  });

  if (!existingAppointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (existingAppointment.status !== AppointmentStatus.PENDING) {
    throw new AppError(httpStatus.CONFLICT, "Appointment is not pending");
  }

  // if (
  //   existingAppointment.status === AppointmentStatus.CANCELLED ||
  //   existingAppointment.status === AppointmentStatus.ONGOING ||
  //   existingAppointment.status === AppointmentStatus.COMPLETED
  // ) {
  //   const appointmentStatus = existingAppointment.status;
  //   throw new Error(
  //     `Appointment is already ${appointmentStatus.toLowerCase()}`,
  //   );
  // }

  // 1. check if the doctor has set a consultation fee or not
  if (!existingAppointment.schedule.doctor.consultationFee) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      "Doctor Has Not Set A Consultation Fee Yet",
    );
  }

  // get the consultation fee
  const amount = existingAppointment.schedule.doctor.consultationFee.toString();

  // 2. create bKash payment
  const bKashIdToken = await getBkashIdToken();

  if (!bKashIdToken) {
    throw new AppError(
      httpStatus.INTERNAL_SERVER_ERROR,
      "bKash id token not found",
    );
  }

  console.log(bKashIdToken);

  const bKashCreatePaymentResponse = await fetch(
    `${config.bkash_base_url}/tokenized/checkout/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${bKashIdToken}`,
        "X-App-Key": config.bkash_app_key,
      },
      body: JSON.stringify({
        mode: "0011",
        payerReference: user.email, // user phone or email
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // payment callback url
        amount: amount,
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: existingAppointment.id, // existing appointment id
      }),
    },
  );

  // get the response status and status text
  console.log(
    "bKash create payment status:",
    bKashCreatePaymentResponse.status,
    bKashCreatePaymentResponse.statusText,
  );

  // get the response json data and log it
  const bKashCreatePaymentResult = await bKashCreatePaymentResponse.json();

  console.log({ bKashCreatePaymentResult });

  // check if the response is ok or not, if not, throw an error
  if (!bKashCreatePaymentResponse.ok) {
    console.error("bKash create payment failed:", bKashCreatePaymentResult);
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      bKashCreatePaymentResult.statusMessage ||
        "Failed to create bKash payment",
    );
  }

  // 2. Payment Model Update
  await prisma.payment.update({
    where: {
      appointmentId: existingAppointment.id,
    },
    data: {
      merchantInvoiceNumber: bKashCreatePaymentResult.merchantInvoiceNumber,
      gatwayResponse: bKashCreatePaymentResult,
      bKashPaymentId: bKashCreatePaymentResult.paymentID,
    },
  });

  return {
    paymentUrl: bKashCreatePaymentResult.bkashURL,
  };
};

// Book Appointment Callback URL
const bookAppointmentCallback = async (query: Record<string, any>) => {
  const transactionResult = await prisma.$transaction(
    async (tx) => {
      const paymentId = query.paymentID;

      if (!paymentId) {
        throw new AppError(httpStatus.BAD_REQUEST, "paymentId not found");
      }

      // payment status
      const status = query.status;

      // check if the payment is successful, if not, throw an error
      if (!status) {
        throw new AppError(httpStatus.BAD_REQUEST, "payment failed");
      }

      // get bKash id token
      const bKashIdToken = await getBkashIdToken();

      // check if bKash id token is found, if not, throw an error
      if (!bKashIdToken) {
        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "bKash id token not found",
        );
      }

      // execute the payment with the payment id
      const executedPaymentResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/execute`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${bKashIdToken}`,
            "X-App-Key": config.bkash_app_key,
          },
          body: JSON.stringify({
            paymentID: paymentId,
          }),
        },
      );

      console.log({ executedPaymentResponse });

      // convert the response to json
      const excutedPaymentResult = await executedPaymentResponse.json();

      console.log("bKash execute payment result:", excutedPaymentResult);

      // check if the payment is successful / fail / cancel, then, redirect them to the dashboard,
      if (status === "success") {
        // get the appointment details
        const appointment = await prisma.appointment.findUnique({
          where: {
            id: excutedPaymentResult.merchantInvoiceNumber,
          },
          include: {
            schedule: true,
            patient: true,
            doctor: true,
          },
        });

        if (!appointment) {
          throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found!");
        }

        // total slot = 3 , available slot = 2
        // (total - available) + 1 => (3 - 2) + 1 = 2 => Serial Number

        // get the already booked slots
        const alreadyBookedSlots =
          appointment.schedule.totalSlots - appointment.schedule.availableSlots;

        const serialNumber = alreadyBookedSlots + 1;

        // 29 August => 3:00 PM - 4:00 PM
        // 1st person joining time => startDateTime = 2026-08-29T15:00:00.000Z => 3:00 PM
        // serial number (1) - 1 * 20 => 0 minues

        // 2nd person joining time => startDateTime = 2026-08-29T15:20:00.000Z => 3:00 PM
        // serial number (2) - 1 * 20 => 20 minutes

        // 3nd person joining time => startDateTime = 2026-08-29T15:40:00.000Z => 3:00 PM
        // serial number (3) - 1 * 20 => 40 mintes

        const joiningTime = addMinutes(
          appointment.schedule.startDateTime,
          (serialNumber - 1) * 20,
        );

        // update the appointment status to confirmed into the DB, after successful payment
        await tx.appointment.update({
          where: {
            id: excutedPaymentResult.merchantInvoiceNumber, // appointment id used as merchantInvoiceNumber in bKash
          },
          data: {
            status: AppointmentStatus.CONFIRMED,
            joiningTime,
            serialNumber,
          },
        });

        const newAvailableSlots = appointment.schedule.availableSlots - 1;

        // update the schedule available slots, after a successful appointment
        await prisma.schedule.update({
          where: {
            id: appointment.schedule.id,
          },
          data: {
            availableSlots: newAvailableSlots,
          },
        });

        // update the payment unfilled data into the DB, after successful payment
        await tx.payment.update({
          where: {
            // appointmentId: excutePaymentResult.merchantInvoiceNumber, // payment id used as merchantInvoiceNumber in bKash
            bKashPaymentId: paymentId,
          },
          data: {
            status: PaymentStatus.PAID,
            bKashTrxId: excutedPaymentResult.trxID,
            paidAt: excutedPaymentResult.paymentExecuteTime,
            gatwayResponse: excutedPaymentResult,
          },
        });

        //? Create PDF Invoice
        // create a pdf invoice after a successful payment and send it to the patient
        const pdfDocument = new PDFDocument({ margin: 50 });

        const pdfChunks: Buffer[] = [];

        // create chunks of data
        pdfDocument.on("data", (chunk: Buffer) => {
          pdfChunks.push(chunk);
        });

        // create a promise to wait for the pdf to be ready (add together all the chunks)
        const pdfReadyPromise = new Promise<Buffer>((resolve) => {
          pdfDocument.on("end", () => {
            resolve(Buffer.concat(pdfChunks));
          });
        });

        pdfDocument
          .fontSize(20)
          .text("PH Healthcare System", { align: "center" });
        pdfDocument
          .fontSize(14)
          .text("Appointment Invoice", { align: "center" });
        pdfDocument.moveDown(2);

        pdfDocument
          .fontSize(12)
          .text(`Patient Name: ${appointment.patient?.name}`);
        pdfDocument.text(`Patient Email: ${appointment.patient?.email}`);
        pdfDocument.moveDown();

        pdfDocument.text(`Doctor Name: ${appointment.doctor?.name}`);
        pdfDocument.text(
          `Specialization: ${appointment.doctor?.specialization}`,
        );
        pdfDocument.moveDown();

        pdfDocument.text(
          `Appointment Date: ${appointment.schedule.startDateTime.toDateString()}`,
        );
        pdfDocument.text(`Your Joining Time: ${joiningTime.toString()}`);
        pdfDocument.text(`Your Serial Number: ${serialNumber}`);
        pdfDocument.text(`Meeting Link: ${appointment.schedule.meetingLink}`);
        pdfDocument.moveDown();

        pdfDocument.text(`Amount Paid: ${excutedPaymentResult.amount} BDT`);
        pdfDocument.text(`Payment Method: bKash`);
        pdfDocument.text(`Transaction Id: ${excutedPaymentResult.trxID}`);
        pdfDocument.text(`Paid At: ${excutedPaymentResult.paymentExecuteTime}`);

        // end the pdf (add together all the chunks)
        pdfDocument.end();

        // wait for the pdf to be ready
        const pdfBuffer = await pdfReadyPromise;

        // send the invoice to the patient
        await transporter.sendMail({
          from: config.email_sender,
          to: appointment.patient.email,
          subject: "Your Appointment Invoice - PH Healthcare System",
          text: "Thank you for booking an appointment. Please find your invoice attached.",
          attachments: [
            {
              filename: "invoice.pdf",
              content: pdfBuffer,
            },
          ],
        });

        return {
          redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`,
        };
      } else if (status === "failure") {
        // update the payment status to failed into the DB, after failed payment
        await tx.payment.update({
          where: {
            bKashPaymentId: paymentId,
          },
          data: {
            status: PaymentStatus.FAILED,
            gatwayResponse: excutedPaymentResult,
          },
        });

        return {
          redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`,
        };
      } else if (status === "cancel") {
        // update the payment status to cancelled into the DB, after cancelled payment
        await tx.payment.update({
          where: {
            bKashPaymentId: paymentId,
          },
          data: {
            status: PaymentStatus.CANCELLED,
            gatwayResponse: excutedPaymentResult,
          },
        });

        return {
          redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`,
        };
      } else {
        // if nothing matches, throw an error
        return {
          excutedPaymentResult,
          redirectUrl: `${config.frontend_url}/dashboard/my-appointment?error=payment-failed`,
        };
      }
    },
    {
      maxWait: 10000, // 10 seconds
      timeout: 30000, // 30 seconds
    },
  );

  return transactionResult;
};

// Cancel Appointment & Refund Payment
const cancelAppointment = async (
  payload: ICancelAppointmentPayload,
  user: RequestUser,
) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
        patient: {
          email: user.email,
        },
      },
      include: {
        payment: true,
        schedule: true,
      },
    });

    if (!existingAppointment) {
      throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
    }

    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new AppError(
        httpStatus.CONFLICT,
        "Appointment is already ongoing or completed",
      );
    }

    if (existingAppointment.status === "CANCELLED") {
      throw new AppError(
        httpStatus.CONFLICT,
        "Appointment is already cancelled",
      );
    }

    // update the appointment status to cancelled into the DB
    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },
      data: {
        status: AppointmentStatus.CANCELLED,
      },
    });

    // update the schedule available slots, after cancelled an appointment
    await prisma.schedule.update({
      where: {
        id: existingAppointment.schedule.id,
      },
      data: {
        availableSlots: { increment: 1 },
      },
    });

    // refund process start from here
    const now = new Date();
    const startDateTime = existingAppointment.schedule.startDateTime; // 29 August : 3:00 PM

    // After 2:00 Pm => no refund
    // must cancel before 2:00 PM
    const refundCutOffTime = subHours(startDateTime, 1);

    // now >  refuncCutOff Time => no refund
    // now < refundCutOff Time => refund eligible
    const isEligibleForRefund = isBefore(now, refundCutOffTime);

    // if eligible for refund then refund the payment
    if (isEligibleForRefund) {
      // bKash Refund Payment Process
      const bKashIdToken = await getBkashIdToken();

      if (!bKashIdToken) {
        throw new AppError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "bKash id token not found",
        );
      }

      const bKashRefundPaymentResponse = await fetch(
        `${config.bkash_base_url}/tokenized/checkout/payment/refund`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${bKashIdToken}`,
            "X-App-Key": config.bkash_app_key,
          },
          body: JSON.stringify({
            paymentID: existingAppointment.payment?.bKashPaymentId,
            trxID: existingAppointment.payment?.bKashTrxId,
            amount: existingAppointment.payment?.amount.toString(),
            sku: "Appointment Cancellation",
            reason: "Patient cancelled the appointment",
          }),
        },
      );

      const bKashRefundPaymentResult = await bKashRefundPaymentResponse.json();

      console.log(bKashRefundPaymentResult);

      // update the payment refund data into the DB
      await tx.payment.update({
        where: {
          appointmentId: appointmentId,
        },
        data: {
          refundTrxId: bKashRefundPaymentResult.refundTrxID,
          refundAt: bKashRefundPaymentResult.completedTime,
          refundAmount: bKashRefundPaymentResult.amount,
          refundReason: "Patient cancelled the appointment",
          status: PaymentStatus.REFUNDED,
          gatwayResponse: bKashRefundPaymentResult,
        },
      });
    }

    // get the new payment info, after refund, and also if the payment is not refundable then show the old payment info
    const newPaymentInfo = await prisma.payment.findUnique({
      where: {
        appointmentId: existingAppointment.id,
      },
    });

    return {
      appointment: updatedAppointment,
      payment: newPaymentInfo,
    };
  });

  return transactionResult;
};

// Update Appointment Status
// DOCTOR ONLY CONFIRMED => ONGOING => COMPLETED
const updateAppointmentStatus = async (
  appointmentId: string,
  payload: IUpdateAppointmentStatusPayload,
  user: RequestUser,
) => {
  // check if the user is a doctor
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  // check if the appointment belongs to the doctor
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId, doctorId: doctor.id },
  });

  if (!appointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment Not Found");
  }

  if (appointment.status === AppointmentStatus.COMPLETED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is already completed",
    );
  }

  if (appointment.status === AppointmentStatus.CANCELLED) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is already cancelled",
    );
  }

  if (appointment.status === AppointmentStatus.PENDING) {
    throw new AppError(
      httpStatus.FORBIDDEN,
      "Appointment is Pending. You can change the status after appointment is confirmed",
    );
  }

  // check if the status is confirmed, then update the status to "ONGOING"
  if (appointment.status === AppointmentStatus.CONFIRMED) {
    // if payload is not "ONGOING" then throw error
    if (payload.status !== "ONGOING") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Confirmed Appointment Must Be Ongoing At First",
      );
    }

    // update the status to "ONGOING"
    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.ONGOING,
      },
    });
  }

  // check if the status is ongoing, then update the status to "COMPLETED"
  if (appointment.status === AppointmentStatus.ONGOING) {
    // if payload is not "COMPLETED" then throw an error
    if (payload.status !== "COMPLETED") {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        "Ongoing Appointment Must Be Complted.",
      );
    }

    // update the status to "COMPLETED"
    await prisma.appointment.update({
      where: {
        id: appointment.id,
      },
      data: {
        status: AppointmentStatus.COMPLETED,
      },
    });
  }

  // get the updated appointment
  const updatedAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointment.id,
    },
  });

  return updatedAppointment;
};

//patient appointments
const getMyAppointments = async (query: IQuery, user: RequestUser) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  // check if the user is a patient
  const patient = await prisma.patient.findUnique({
    where: { userId: user.userId },
  });

  if (!patient) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
  }

  const andConditions: AppointmentWhereInput[] = [
    {
      patientId: patient.id,
    },
  ];

  if (query.status) {
    andConditions.push({ status: query.status });
  }

  const appointments = await prisma.appointment.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy: { [sortBy]: sortOrder },
    include: {
      doctor: { select: { id: true, name: true, specialization: true } },
      schedule: true,
      payment: true,
    },
  });

  const total = await prisma.appointment.count({
    where: { AND: andConditions },
  });

  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

//doctor appointments
const getDoctorAppointments = async (query: IQuery, user: RequestUser) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  // check if the user is a doctor
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  const andConditions: AppointmentWhereInput[] = [
    {
      doctorId: doctor.id,
    },
  ];

  if (query.status) {
    andConditions.push({ status: query.status });
  }

  const appointments = await prisma.appointment.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy: { [sortBy]: sortOrder },
    include: {
      patient: {
        select: { id: true, name: true, email: true, contactNumber: true },
      },
      schedule: true,
      payment: true,
    },
  });

  const total = await prisma.appointment.count({
    where: { AND: andConditions },
  });

  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

//admin super admin
const getAllAppointments = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: AppointmentWhereInput[] = [];

  if (query.status) {
    andConditions.push({ status: query.status });
  }

  if (query.doctorId) {
    andConditions.push({ doctorId: query.doctorId });
  }

  if (query.patientId) {
    andConditions.push({ patientId: query.patientId });
  }

  if (query.doctorEmail) {
    andConditions.push({
      doctor: {
        email: query.doctorEmail,
      },
    });
  }
  if (query.patientEmail) {
    andConditions.push({
      patient: {
        email: query.patientEmail,
      },
    });
  }

  const appointments = await prisma.appointment.findMany({
    where: { AND: andConditions },
    take: limit,
    skip,
    orderBy: { [sortBy]: sortOrder },
    include: {
      patient: { select: { id: true, name: true, email: true } },
      doctor: { select: { id: true, name: true, specialization: true } },
      schedule: true,
      payment: true,
    },
  });

  const total = await prisma.appointment.count({
    where: { AND: andConditions },
  });

  return {
    data: appointments,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// for all logged in user
const getSingleAppointment = async (
  appointmentId: string,
  user: RequestUser,
) => {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      patient: { select: { id: true, name: true, email: true, userId: true } },
      doctor: {
        select: { id: true, name: true, specialization: true, userId: true },
      },
      schedule: true,
      payment: true,
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

  return appointment;
};

export const AppointmentServices = {
  bookAppointment,
  payAppoinment,
  bookAppointmentCallback,
  cancelAppointment,
  updateAppointmentStatus,
  getMyAppointments,
  getDoctorAppointments,
  getAllAppointments,
  getSingleAppointment,
};
