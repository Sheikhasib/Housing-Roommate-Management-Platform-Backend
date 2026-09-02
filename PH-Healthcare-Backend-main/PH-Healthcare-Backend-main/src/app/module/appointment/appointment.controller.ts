import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppointmentServices } from "./appointment.service";

// Book Appointment
const bookAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.bookAppointment(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Payment Initiated Successfully",
      data: result,
    });
  },
);

// Pay Appointment if it is pending
const payAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.payAppoinment(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Payment Initiated Successfully",
      data: result,
    });
  },
);

// Book Appointment Callback URL
const bookAppointmentCallback = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    console.log("Req.Query: ", req.query);

    const { redirectUrl } = await AppointmentServices.bookAppointmentCallback(
      req.query,
    );

    res.redirect(redirectUrl);

    // sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "Appointment Booked Successfully with payment",
    //   data: result,
    // });
  },
);

// Cancel Appointment & Refund Payment
const cancelAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.cancelAppointment(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Cancelled & Payment Refunded Successfully",
      data: result,
    });
  },
);

// Update Appointment Status
const updateAppointmentStatus = catchAsync(
  async (req: Request, res: Response) => {
    const appointmentId = req.params.appointmentId as string;
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.updateAppointmentStatus(
      appointmentId,
      payload,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Status Updated Successfully",
      data: result,
    });
  },
);

// Get My Appointments
const getMyAppointments = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;

  const { data, meta } = await AppointmentServices.getMyAppointments(
    req.query,
    user,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments Retrieved Successfully",
    data,
    meta,
  });
});

// Get Doctor Appointments
const getDoctorAppointments = catchAsync(
  async (req: Request, res: Response) => {
    const user = req.user!;

    const { data, meta } = await AppointmentServices.getDoctorAppointments(
      req.query,
      user,
    );
    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointments Retrieved Successfully",
      data,
      meta,
    });
  },
);

// Get All Appointments
const getAllAppointments = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await AppointmentServices.getAllAppointments(
    req.query,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointments Retrieved Successfully",
    data,
    meta,
  });
});

// Get Single Appointment by Id
const getSingleAppointment = catchAsync(async (req: Request, res: Response) => {
  const appointmentId = req.params.appointmentId as string;
  const user = req.user!;

  const result = await AppointmentServices.getSingleAppointment(
    appointmentId,
    user,
  );
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Appointment Retrieved Successfully",
    data: result,
  });
});

export const AppointmentController = {
  bookAppointment,
  payAppointment,
  cancelAppointment,
  bookAppointmentCallback,
  updateAppointmentStatus,
  getMyAppointments,
  getDoctorAppointments,
  getAllAppointments,
  getSingleAppointment,
};
