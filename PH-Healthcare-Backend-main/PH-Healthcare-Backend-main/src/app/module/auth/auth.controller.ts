import { join } from "./../../../generated/prisma/internal/prismaNamespace";
import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";
import { AuthValidation } from "./auth.validation";

// Register route
const registerPatient = catchAsync(async (req: Request, res: Response) => {
  // const payload = AuthValidation.PatientRegisterZodSchema.safeParse(req.body);
  // console.log(payload);

  // // Check if the validation was successful, if not, throw an error
  // if (!payload.success) {
  //   console.log(payload.error);
  //   console.log(payload.error.issues);

  //   // Collect all error messages into a single string
  //   // Option-1: Using forEach loop
  //   // let errorMessages = "";

  //   // payload.error.issues.forEach((issue) => {
  //   //   errorMessages =
  //   //     errorMessages +
  //   //     `Field: ${issue.path.join(".")}, Error: ${issue.message}.\n`;
  //   // });

  //   // Option-2: Using map and join
  //   // const errorMessages = payload.error.issues
  //   //   .map((issue) => `Field: ${issue.path.join(".")}, Error: ${issue.message}`)
  //   //   .join(", ");

  //   // throw new Error(errorMessages);
  //   throw new Error(payload.error.issues[0].message);
  // }

  const payload = req.body;

  await AuthService.registerPatient(payload as any);

  // const { accessToken, refreshToken, user, patient } = result;

  // res.cookie("accessToken", accessToken, {
  //   httpOnly: true,
  //   secure: false,
  //   sameSite: "none",
  //   maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
  // });
  // res.cookie("refreshToken", refreshToken, {
  //   httpOnly: true,
  //   secure: false,
  //   sameSite: "none",
  //   maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  // });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Verification OTP sent successfully",
    data: null,
  });
});

// Verify Patient Email
const verifyPatientEmail = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await AuthService.verifyPatientEmail(payload);

  const { accessToken, refreshToken, user, patient } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Email verified successfully",
    data: {
      accessToken,
      refreshToken,
      user,
      patient,
    },
  });
});

// Login User
const loginUser = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const result = await AuthService.loginUser(payload);
  const { accessToken, refreshToken } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User logged in successfully",
    data: {
      accessToken,
      refreshToken,
    },
  });
});

// Get Me route
const getMe = catchAsync(async (req: Request, res: Response) => {
  const user = req.user as unknown as IRequestUser;

  if (!user) {
    throw new AppError(httpStatus.BAD_REQUEST, "User information is missing in the request");
  }

  const result = await AuthService.getMe(user);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User profile fetched successfully",
    data: result,
  });
});

// Refresh Token
const refreshToken = catchAsync(async (req: Request, res: Response) => {
  if (!req.cookies.refreshToken) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing");
  }
  const result = await AuthService.refreshToken(req.cookies.refreshToken);
  const { accessToken, refreshToken: newRefreshToken } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
  });
  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "New tokens generated successfully",
    data: {
      accessToken,
      refreshToken: newRefreshToken,
    },
  });
});

// Google Login
const googleLogin = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  const result = await AuthService.googleLogin(payload);
  const { accessToken, refreshToken } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24, // 24 hour or 1 day
  });
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "none",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "New tokens generated successfully",
    data: {
      accessToken,
      refreshToken,
    },
  });
});

// Forgot Password
const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  await AuthService.forgotPassword(payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: `OTP sent to Email: ${payload.email}`,
    data: null,
  });
});

// Reset Password
const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;

  await AuthService.resetPassword(payload);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Password reset successfully",
    data: null,
  });
});

export const AuthController = {
  registerPatient,
  verifyPatientEmail,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgotPassword,
  resetPassword,
};
