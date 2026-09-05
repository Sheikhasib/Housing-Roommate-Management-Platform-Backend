import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { InvoiceServices } from "./invoice.service";

// My invoices (TENANT)
const getMyInvoices = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await InvoiceServices.getMyInvoices(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Invoices fetched successfully",
		data,
		meta,
	});
});

// Invoices for a room (OWNER)
const getRoomInvoices = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;
	const user = req.user!;

	const { data, meta } = await InvoiceServices.getRoomInvoices(
		user,
		roomId,
		req.query,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Invoices fetched successfully",
		data,
		meta,
	});
});

// Create a utility bill and split it among roommates (OWNER)
const createUtilityBill = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await InvoiceServices.createUtilityBill(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Utility bill created and split among roommates",
		data: result,
	});
});

// Pay an invoice (TENANT)
const payInvoice = catchAsync(async (req: Request, res: Response) => {
	const invoiceId = req.params.invoiceId as string;
	const user = req.user!;

	const result = await InvoiceServices.payInvoice(invoiceId, user, req.body);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Payment session created successfully",
		data: result,
	});
});

export const InvoiceController = {
	getMyInvoices,
	getRoomInvoices,
	createUtilityBill,
	payInvoice,
};
