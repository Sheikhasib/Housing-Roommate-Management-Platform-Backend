import z from "zod";
import httpStatus from "http-status";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { NextFunction, Request, Response } from "express";

export const validateRequest = (zodSchema: z.ZodTypeAny) => {
	return catchAsync((req: Request, res: Response, next: NextFunction) => {
		const payload = req.body ?? {};

		const result = zodSchema.safeParse(payload);

		// Check if the validation was successful, if not, throw an error
		if (!result.success) {
			console.log(result.error.issues);

			// Map zod issues into a structured [{ field, message }] list so the API
			// returns meaningful per-field errors to the client.
			const issues = result.error.issues.map((issue) => ({
				field: issue.path.join(".") || undefined,
				message: issue.message,
			}));

			throw new AppError(httpStatus.BAD_REQUEST, issues[0].message, "", issues);
		}

		req.body = result.data; // Assign the validated data back to req.body

		next();
	});
};
