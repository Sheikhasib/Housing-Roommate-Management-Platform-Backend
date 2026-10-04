import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import type { ICreateContactMessagePayload } from "./contact.interface";
import { ContactServices } from "./contact.service";

// Send a message from the public contact form (no auth)
const createContactMessage = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body as ICreateContactMessagePayload;

	const result = await ContactServices.createContactMessage(payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Message received. We will get back to you soon.",
		data: { id: result.id },
	});
});

export const ContactController = {
	createContactMessage,
};
