import type { Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ManagerServices } from "./manager.service";

// Get my manager profile
const getMyManagerProfile = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const result = await ManagerServices.getMyManagerProfile(user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager profile fetched successfully",
		data: result,
	});
});

// Update my manager profile
const updateMyManagerProfile = catchAsync(
	async (req: Request, res: Response) => {
		const payload = req.body;
		const user = req.user!;

		const result = await ManagerServices.updateMyManagerProfile(payload, user);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Manager profile updated successfully",
			data: result,
		});
	},
);

// Properties I am assigned to (delegation scope)
const getMyManagedProperties = catchAsync(
	async (req: Request, res: Response) => {
		const user = req.user!;

		const { data, meta } = await ManagerServices.getMyManagedProperties(
			user,
			req.query,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Properties fetched successfully",
			data,
			meta,
		});
	},
);

export const ManagerController = {
	getMyManagerProfile,
	updateMyManagerProfile,
	getMyManagedProperties,
};
