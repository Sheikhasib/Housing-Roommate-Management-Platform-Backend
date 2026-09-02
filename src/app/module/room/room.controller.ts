import type { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import { RoomServices } from "./room.service";

// Create room (OWNER)
const createRoom = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const user = req.user!;

	const result = await RoomServices.createRoom(payload, user);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Room created successfully",
		data: result,
	});
});

// Get my rooms (OWNER)
const getMyRooms = catchAsync(async (req: Request, res: Response) => {
	const user = req.user!;

	const { data, meta } = await RoomServices.getMyRooms(user, req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Rooms fetched successfully",
		data,
		meta,
	});
});

// Public room search (no auth)
const getPublicRooms = catchAsync(async (req: Request, res: Response) => {
	const result = await RoomServices.getPublicRooms(req.query);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Rooms fetched successfully",
		data: result.data,
		meta: result.meta,
	});
});

// Single room detail (public / owner / admin aware)
const getRoomDetail = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;

	const result = await RoomServices.getRoomDetail(roomId, req.user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Room fetched successfully",
		data: result,
	});
});

// Update room (OWNER)
const updateRoom = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await RoomServices.updateRoom(roomId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Room updated successfully",
		data: result,
	});
});

// Set availability (OWNER)
const setRoomAvailability = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;
	const payload = req.body;
	const user = req.user!;

	const result = await RoomServices.setRoomAvailability(roomId, payload, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Room availability updated successfully",
		data: result,
	});
});

// Delete room (OWNER / ADMIN)
const deleteRoom = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;
	const user = req.user!;

	const result = await RoomServices.deleteRoom(roomId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Room deleted successfully",
		data: result,
	});
});

// Upload room images (OWNER)
const uploadRoomImages = catchAsync(
	async (req: Request, res: Response, next: NextFunction) => {
		const roomId = req.params.roomId as string;
		const user = req.user!;
		const files = (req.files as Express.Multer.File[]) || [];

		if (files.length === 0) {
			throw new AppError(httpStatus.BAD_REQUEST, "No images uploaded");
		}

		const buffers = files.map((file) => file.buffer);

		const result = await RoomServices.uploadRoomImages(roomId, buffers, user);

		sendResponse(res, {
			statusCode: httpStatus.OK,
			success: true,
			message: "Room images uploaded successfully",
			data: result,
		});
	},
);

// Remove room image (OWNER)
const removeRoomImage = catchAsync(async (req: Request, res: Response) => {
	const roomId = req.params.roomId as string;
	const publicId = req.body?.publicId as string;
	const user = req.user!;

	if (!publicId) {
		throw new AppError(httpStatus.BAD_REQUEST, "publicId is required");
	}

	const result = await RoomServices.removeRoomImage(roomId, publicId, user);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Room image removed successfully",
		data: result,
	});
});

export const RoomController = {
	createRoom,
	getMyRooms,
	getPublicRooms,
	getRoomDetail,
	updateRoom,
	setRoomAvailability,
	deleteRoom,
	uploadRoomImages,
	removeRoomImage,
};
