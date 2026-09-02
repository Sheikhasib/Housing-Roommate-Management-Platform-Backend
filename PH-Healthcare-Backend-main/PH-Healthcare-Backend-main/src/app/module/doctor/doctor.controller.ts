import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { DoctorServices } from "./doctor.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation";

const applyAsDoctor = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const files = req.files as {
      resume?: Express.Multer.File[];
      additionalFiles?: Express.Multer.File[];
    };

    console.log(files);

    const resume = files?.["resume"] ? files?.["resume"][0] : null;
    const additionalFiles = files?.["additionalFiles"] || [];

    const zodValidationResult = ApplyAsDoctorValidationZodSchema.safeParse(
      JSON.parse(req.body.data),
    );

    if (!zodValidationResult.success) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        zodValidationResult.error.issues[0].message,
      );
    }

    const payload = zodValidationResult.data;

    const result = await DoctorServices.applyAsDoctor(
      payload,
      resume,
      additionalFiles,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor application submitted successfully",
      data: result,
    });
  },
);

// Verify Doctor Email
const verifyDoctorEmail = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;

    const result = await DoctorServices.verifyDoctorEmail(payload);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor Email Verified Successfully",
      data: result,
    });
  },
);

// Approve Doctor
const approveDoctor = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await DoctorServices.approveDoctor(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor Approved Successfully",
      data: result,
    });
  },
);

// Get All Doctors
const getAllDoctors = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { data, meta } = await DoctorServices.getAllDoctors(req.query);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctors fetched successfully",
      data: data,
      meta: meta,
    });
  },
);

// Update Doctor Profile
const updateDoctorProfile = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;

  const result = await DoctorServices.updateDoctorProfile(payload, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Doctor Profile Updated Successfully",
    data: result,
  });
});

// Get Available Doctors By Todays Schedule
const getAvailableDoctorByTodaysSchedule = catchAsync(
  async (req: Request, res: Response) => {
    const { data, meta } =
      await DoctorServices.getAvailableDoctorByTodaysSchedule(req.query);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Today's Available Doctors Retrieved Successfully",
      data,
      meta,
    });
  },
);

// Get All Doctors List
const getAllDoctorsListPublic = catchAsync(
  async (req: Request, res: Response) => {
    const { data, meta } = await DoctorServices.getAllDoctorsListPublic(
      req.query,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctors Retrieved Successfully",
      data,
      meta,
    });
  },
);

// Get Single Doctor Public Profile
const getSingleDoctorPublicProfile = catchAsync(
  async (req: Request, res: Response) => {
    const doctorId = req.params.doctorId as string;

    const result = await DoctorServices.getSingleDoctorPublicProfile(doctorId);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor Profile Retrieved Successfully",
      data: result,
    });
  },
);

export const DoctorController = {
  applyAsDoctor,
  verifyDoctorEmail,
  approveDoctor,
  getAllDoctors,
  updateDoctorProfile,
  getAvailableDoctorByTodaysSchedule,
  getAllDoctorsListPublic,
  getSingleDoctorPublicProfile,
};
