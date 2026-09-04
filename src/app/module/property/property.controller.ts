import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { PropertyServices } from "./property.service";

// Create a property (OWNER)
const createProperty = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await PropertyServices.createProperty(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Property created successfully",
		data: result,
	});
});

// Get my properties (OWNER)
const getMyProperties = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await PropertyServices.getMyProperties(
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
});

// Public property listing
const getPublicProperties = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await PropertyServices.getPublicProperties(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Properties fetched successfully",
		data,
		meta,
	});
});

// Single property detail (public / owner / admin aware)
const getPropertyDetail = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;

	const result = await PropertyServices.getPropertyDetail(propertyId, req.user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Property fetched successfully",
		data: result,
	});
});

// Update a property (OWNER)
const updateProperty = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await PropertyServices.updateProperty(
		propertyId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Property updated successfully",
		data: result,
	});
});

// Soft delete a property
const deleteProperty = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const user = req.user!;
	const isAdmin = user.role === "ADMIN" || user.role === "SUPER_ADMIN";

	const result = await PropertyServices.deleteProperty(
		propertyId,
		user,
		isAdmin,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Property deleted successfully",
		data: result,
	});
});

// All properties (ADMIN moderation view)
const getAllProperties = catchAsync(async (req: Request, res: Response) => {
	const { data, meta } = await PropertyServices.getAllProperties(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Properties fetched successfully",
		data,
		meta,
	});
});

// Create a unit inside a property (OWNER)
const createUnit = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await PropertyServices.createUnit(propertyId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Unit created successfully",
		data: result,
	});
});

// Update a unit (OWNER)
const updateUnit = catchAsync(async (req: Request, res: Response) => {
	const unitId = req.params.unitId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await PropertyServices.updateUnit(unitId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Unit updated successfully",
		data: result,
	});
});

// Delete a unit (OWNER)
const deleteUnit = catchAsync(async (req: Request, res: Response) => {
	const unitId = req.params.unitId as string;
	const user = req.user!;

	const result = await PropertyServices.deleteUnit(unitId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Unit deleted successfully",
		data: result,
	});
});

// Upload property images
const uploadPropertyImages = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const propertyId = req.params.propertyId as string;
		const user = req.user!;
		const files = (req.files as Express.Multer.File[]) || [];

		if (files.length === 0) {
			throw new AppError(httpStatus.BAD_REQUEST, "No images uploaded");
		}

		const buffers = files.map((file) => file.buffer);

		const result = await PropertyServices.uploadPropertyImages(
			propertyId,
			buffers,
			user,
		);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Property images uploaded successfully",
			data: result,
		});
	},
);

// Remove a property image
const removePropertyImage = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const publicId = req.body?.publicId as string;
	const user = req.user!;

	if (!publicId) {
		throw new AppError(httpStatus.BAD_REQUEST, "publicId is required");
	}

	const result = await PropertyServices.removePropertyImage(
		propertyId,
		publicId,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Property image removed successfully",
		data: result,
	});
});

// Assign a manager to one of the caller's properties (OWNER)
const assignManager = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await PropertyServices.assignManager(
		propertyId,
		payload,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager assigned successfully",
		data: result,
	});
});

// List the managers of a property (owner or assigned manager)
const listManagers = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const user = req.user!;

	const result = await PropertyServices.listManagers(propertyId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Managers fetched successfully",
		data: result,
	});
});

// Revoke a manager's assignment (OWNER)
const removeManager = catchAsync(async (req: Request, res: Response) => {
	const propertyId = req.params.propertyId as string;
	const managerId = req.params.managerId as string;
	const user = req.user!;

	const result = await PropertyServices.removeManager(
		propertyId,
		managerId,
		user,
	);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Manager removed successfully",
		data: result,
	});
});

export const PropertyController = {
	createProperty,
	getMyProperties,
	getPublicProperties,
	getPropertyDetail,
	updateProperty,
	deleteProperty,
	getAllProperties,
	createUnit,
	updateUnit,
	deleteUnit,
	uploadPropertyImages,
	removePropertyImage,
	assignManager,
	listManagers,
	removeManager,
};
