import type { Request, Response } from "express";
import httpStatus from "http-status";

export const notFound = (req: Request, res: Response) => {
	res.status(httpStatus.NOT_FOUND).json({
		success: false,
		statusCode: httpStatus.NOT_FOUND,
		message: "Route not found",
		errors: [{ message: `Cannot find ${req.method} ${req.originalUrl}` }],
		path: req.originalUrl,
		date: new Date(),
	});
};
