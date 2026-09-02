import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { UserServices } from "./user.service";

// Upload profile image
const uploadProfileImage = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    console.log(req.file?.buffer, "Request File");
    const userId = req.user?.userId;

    // Check if a file was uploaded
    if (!req.file) {
      throw new AppError(httpStatus.BAD_REQUEST, "No file uploaded");
    }

    const result = await UserServices.uploadProfileImage(
      req.file?.buffer,
      userId as string,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "User profile image uploaded successfully",
      data: result,
    });
  },
);

export const UserController = {
  uploadProfileImage,
};
