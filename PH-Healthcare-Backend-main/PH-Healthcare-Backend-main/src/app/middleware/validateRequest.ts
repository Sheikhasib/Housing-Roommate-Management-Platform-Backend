import z from "zod";
import httpStatus from "http-status";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";

export const validateRequest = (zodSchema: z.ZodObject) => {
  return catchAsync((req: Request, res: Response, next: NextFunction) => {
    // const payload = req.body ? req.body : {};
    const payload = req.body ?? {};

    const result = zodSchema.safeParse(payload);

    // Check if the validation was successful, if not, throw an error
    if (!result.success) {
      console.log(result.error);
      console.log(result.error.issues);

      throw new AppError(httpStatus.BAD_REQUEST, result.error.issues[0].message);
    }

    req.body = result.data; // Assign the validated data back to req.body

    next();
  });
};
