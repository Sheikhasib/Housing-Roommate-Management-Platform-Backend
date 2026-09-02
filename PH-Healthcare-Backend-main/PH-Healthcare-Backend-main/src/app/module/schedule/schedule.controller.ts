import { Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { ScheduleServices } from "./schedule.service";
import httpStatus from "http-status";

// Create Schedule
const createSchedule = catchAsync(async (req: Request, res: Response) => {
  const payload = req.body;
  const user = req.user!;

  const result = await ScheduleServices.createSchedule(payload, user);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Schedule Created Successfully",
    data: result,
  });
});

// Get My Schedules
const getMySchedules = catchAsync(async (req: Request, res: Response) => {
  const user = req.user!;

  const { data, meta } = await ScheduleServices.getMySchedules(req.query, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedules Retrieved Successfully",
    data,
    meta,
  });
});

// Get All Schedules
const getAllSchedules = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await ScheduleServices.getAllSchedules(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedules Retrieved Successfully",
    data,
    meta,
  });
});

// Get Today's Schedules
const getTodaysSchedules = catchAsync(async (req: Request, res: Response) => {
  const { data, meta } = await ScheduleServices.getTodaysSchedules(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Today's Schedules Retrieved Successfully",
    data,
    meta,
  });
});

// Get Schedule By Id
const getScheduleById = catchAsync(async (req: Request, res: Response) => {
  const scheduleId = req.params.scheduleId as string;

  const result = await ScheduleServices.getScheduleById(scheduleId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedule Retrieved Successfully",
    data: result,
  });
});

// Update Schedule
const updateSchedule = catchAsync(async (req: Request, res: Response) => {
  const scheduleId = req.params.scheduleId as string;
  const payload = req.body;
  const user = req.user!;

  const result = await ScheduleServices.updateSchedule(
    scheduleId,
    payload,
    user,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedule Updated Successfully",
    data: result,
  });
});

// Publish Schedule
const publishSchedule = catchAsync(async (req: Request, res: Response) => {
  const scheduleId = req.params.scheduleId as string;
  const user = req.user!;

  const result = await ScheduleServices.publishSchedule(scheduleId, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedule Published Successfully",
    data: result,
  });
});

// Delete Schedule
const deleteSchedule = catchAsync(async (req: Request, res: Response) => {
  const scheduleId = req.params.scheduleId as string;
  const user = req.user!;

  const result = await ScheduleServices.deleteSchedule(scheduleId, user);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Schedule Deleted Successfully",
    data: result,
  });
});

export const ScheduleController = {
  createSchedule,
  getMySchedules,
  getAllSchedules,
  getTodaysSchedules,
  getScheduleById,
  updateSchedule,
  publishSchedule,
  deleteSchedule,
};
