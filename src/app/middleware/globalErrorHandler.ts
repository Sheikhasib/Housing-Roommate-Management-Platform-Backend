import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { Prisma } from "../../generated/prisma/client";
import config from "../config";
import { AppError } from "../utils/AppError";

// Central error handler. Every thrown error is converted into the standard
// response shape:
// { success: false, message: "...", errors: [...], statusCode }
export const globalErrorHandler = async (
	err: any,
	_req: Request,
	res: Response,
	_next: NextFunction,
) => {
	if (config.node_env === "development") {
		console.log("Error from Global Error Handler", err);
	}

	let statusCode: number = httpStatus.INTERNAL_SERVER_ERROR;
	let errorMessage = err.message || "Internal Server Error";
	const errorName = err.name || "Internal Server Error";
	let errors: { field?: string; message: string }[] = [];

	if (err instanceof Prisma.PrismaClientValidationError) {
		statusCode = httpStatus.BAD_REQUEST;
		errorMessage = "You have provided incorrect field type or missing fields";
		errors = [{ message: errorMessage }];
	} else if (err instanceof Prisma.PrismaClientKnownRequestError) {
		if (err.code === "P2002") {
			statusCode = httpStatus.CONFLICT;
			errorMessage = "Duplicate Key Error";
			errors = [
				{
					field: (err.meta?.target as string) || undefined,
					message: "A record with the same value already exists",
				},
			];
		} else if (err.code === "P2003") {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = "Foreign key constraint failed";
			errors = [{ message: errorMessage }];
		} else if (err.code === "P2025") {
			statusCode = httpStatus.NOT_FOUND;
			errorMessage =
				"An operation failed because it depends on one or more records that were required but not found.";
			errors = [{ message: errorMessage }];
		}
	} else if (err instanceof Prisma.PrismaClientInitializationError) {
		if (err.errorCode === "P1000") {
			statusCode = httpStatus.UNAUTHORIZED;
			errorMessage =
				"Authentication failed against database server. Please Check Your Credentials";
		} else if (err.errorCode === "P1001") {
			statusCode = httpStatus.BAD_REQUEST;
			errorMessage = "Can't reach database server";
		}
		errors = [{ message: errorMessage }];
	} else if (err instanceof Prisma.PrismaClientUnknownRequestError) {
		statusCode = httpStatus.INTERNAL_SERVER_ERROR;
		errorMessage = "Error occurred during query execution";
		errors = [{ message: errorMessage }];
	} else if (err instanceof AppError) {
		errorMessage = err.message;
		statusCode = err.statusCode;
		// validation / structured issues provided alongside the error
		errors = err.issues || [{ message: errorMessage }];
	} else if (err instanceof Error) {
		errorMessage = err.message;
		errors = [{ message: errorMessage }];
	}

	res.status(statusCode).json({
		success: false,
		statusCode: statusCode || httpStatus.INTERNAL_SERVER_ERROR,
		message:
			config.node_env === "development" ? errorMessage : "Something went wrong",
		errors,
		name:
			config.node_env === "development" ? errorName : "Internal Server Error",
		stack: config.node_env === "development" ? err.stack : undefined,
	});
};
