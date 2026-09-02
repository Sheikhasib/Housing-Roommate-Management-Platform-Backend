import {
  addDays,
  differenceInMinutes,
  isAfter,
  isSameDay,
  startOfDay,
} from "date-fns";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import {
  ICreateSchedulePayload,
  IUpdateSchedulePayload,
} from "./schedule.interface";
import httpStatus from "http-status";
import { ScheduleWhereInput } from "../../../generated/prisma/models";
import { ScheduleStatus } from "../../../generated/prisma/enums";
import { IQuery } from "../../interfaces";

// create schedule
const createSchedule = async (
  payload: ICreateSchedulePayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  // 28 August => start Time  : 9:00 PM
  // 29 August => end Time : 3:00AM

  // check if start time and end time are on the same day
  if (!isSameDay(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start Date Time And End Date Time Must Be On The Same Day",
    );
  }

  // check if start time is before end time
  if (isAfter(payload.startDateTime, payload.endDateTime)) {
    // 28 August =>  3:00 PM - 9:00 PM
    throw new AppError(
      httpStatus.CONFLICT,
      "Start Date Time Cannot Be After End Date Time",
    );
  }

  //startDateTime = 2026-08-29T13:30:00.436Z => 1:30 PM
  const startOfTheDay = startOfDay(payload.startDateTime); // 29 August = 12.00 AM => 2026-08-29T00:00:00.000Z
  const startOfNextDay = addDays(startOfTheDay, 1); // 30 August = 12.00 AM => 2026-08-30T00:00:00.000Z

  const existingScheduleOnThisDate = await prisma.schedule.findFirst({
    where: {
      doctorId: doctor.id,
      isDeleted: false,
      startDateTime: {
        gte: startOfTheDay,
        lt: startOfNextDay, // don't use "lte", because it will include the startOfNextDay
      },
    },
  });

  if (existingScheduleOnThisDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "You Already Have A Schedule For This Date",
    );
  }

  const durationInMinutes = differenceInMinutes(
    payload.endDateTime,
    payload.startDateTime,
  );

  const MINUTES_ALLOCATED_PER_SLOT = 20;

  const totalSlots = Math.floor(durationInMinutes / MINUTES_ALLOCATED_PER_SLOT);

  if (totalSlots < 1) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Schedule Must Be At Least ${MINUTES_ALLOCATED_PER_SLOT} Minutes Long To Fit One Slot`,
    );
  }

  const schedule = await prisma.schedule.create({
    data: {
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      meetingLink: payload.meetingLink,
      totalSlots,
      availableSlots: totalSlots,
      doctorId: doctor.id,
    },
    include: {
      doctor: {
        select: {
          name: true,
          email: true,
          contactNumber: true,
        },
      },
    },
  });

  return schedule;
};

// Get My Schedule
const getMySchedules = async (query: IQuery, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: {
      userId: user.userId,
    },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor not found");
  }

  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: ScheduleWhereInput[] = [
    {
      doctorId: doctor.id,
    },
    {
      isDeleted: false,
    },
  ];

  // Filter by status
  if (query.status) {
    andConditions.push({ status: query.status });
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },

    take: limit,
    skip,
    orderBy: {
      // sortBy : sortOrder
      [sortBy]: sortOrder,
    },
    include: {
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });

  const total = await prisma.schedule.count({ where: { AND: andConditions } });

  return {
    data: schedules,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Get All Schedules
const getAllSchedules = async (query: IQuery) => {
  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const andConditions: ScheduleWhereInput[] = [];

  // Filtering
  if (query.doctorId) {
    andConditions.push({ doctorId: query.doctorId });
  }
  if (query.email) {
    andConditions.push({
      doctor: {
        email: query.email,
      },
    });
  }

  if (query.status) {
    andConditions.push({ status: query.status });
  }

  // Searching
  if (query.searchTerm) {
    andConditions.push({
      doctor: {
        OR: [
          { name: { contains: query.searchTerm, mode: "insensitive" } },
          { email: { contains: query.searchTerm, mode: "insensitive" } },
          {
            specialization: { contains: query.searchTerm, mode: "insensitive" },
          },
        ],
      },
    });
  }

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },

    take: limit,
    skip,
    orderBy: {
      // sortBy : sortOrder
      [sortBy]: sortOrder,
    },
    include: {
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });

  const total = await prisma.schedule.count({ where: { AND: andConditions } });

  return {
    data: schedules,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// Get Schedule by ID
const getScheduleById = async (scheduleId: string) => {
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      doctor: {
        select: {
          id: true,
          name: true,
          email: true,
          specialization: true,
          userId: true,
        },
      },
      appointments: {
        include: {
          patient: true,
        },
      },
    },
  });

  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
  }

  return schedule;
};

// Update Schedule
const updateSchedule = async (
  scheduleId: string,
  payload: IUpdateSchedulePayload,
  user: RequestUser,
) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId, doctorId: doctor.id },
  });

  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
  }

  if (
    schedule.status === ScheduleStatus.PUBLISHED &&
    schedule.totalSlots !== schedule.availableSlots
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Schedule Once Published And Appoinemtn Booked Cannot Be Updated",
    );
  }

  // if (schedule.doctorId !== doctor.id) {
  //     throw new AppError(
  //         httpStatus.FORBIDDEN,
  //         "You Are Not Allowed To Update This Schedule",
  //     );
  // }

  // const updateData : IUpdateSchedulePayload = {};

  // if(payload.meetingLink){
  //     updateData.meetingLink = payload.meetingLink || schedule.meetingLink
  // }

  payload.meetingLink = payload.meetingLink || schedule.meetingLink;
  payload.startDateTime = payload.startDateTime || schedule.startDateTime;
  payload.endDateTime = payload.endDateTime || schedule.endDateTime;

  // 28 August => start Time  : 9:00 PM
  // 29 August => end Time : 3:00AM

  if (!isSameDay(payload.startDateTime, payload.endDateTime)) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Start Date Time And End Date Time Must Be On The Same Day",
    );
  }
  if (isAfter(payload.startDateTime, payload.endDateTime)) {
    // 28 August =>  3:00 PM - 9:00 PM

    throw new AppError(
      httpStatus.CONFLICT,
      "Start Date Time Cannot Be After End Date Time",
    );
  }

  //startDateTime = 2026-08-28T13:30:00.436Z => 1:30 PM
  const startOfTheDay = startOfDay(payload.startDateTime); // 25 August => 12:00 AM => 2026-08-28T00:00:00.436Z
  const startOfNextDay = addDays(startOfTheDay, 1); // 29 August => 12:00 AM => 2026-08-29T00:00:00.436Z

  const existingScheduleOnThisDate = await prisma.schedule.findFirst({
    where: {
      doctorId: doctor.id,
      isDeleted: false,
      startDateTime: {
        gte: startOfTheDay,
        lt: startOfNextDay,
      },
    },
  });

  if (existingScheduleOnThisDate) {
    throw new AppError(
      httpStatus.CONFLICT,
      "You Already Have A Schedule For This Date",
    );
  }

  const durationInMinutes = differenceInMinutes(
    payload.endDateTime,
    payload.startDateTime,
  );

  const MINUTES_ALLOCATED_PER_SLOT = 20;

  const totalSlots = Math.floor(durationInMinutes / MINUTES_ALLOCATED_PER_SLOT);

  if (totalSlots < 1) {
    throw new AppError(
      httpStatus.CONFLICT,
      `Schedule Must Be At Least ${MINUTES_ALLOCATED_PER_SLOT} Minutes Long To Fit One Slot`,
    );
  }

  const updatedSchedule = await prisma.schedule.update({
    where: {
      id: schedule.id,
    },
    data: {
      startDateTime: payload.startDateTime,
      endDateTime: payload.endDateTime,
      meetingLink: payload.meetingLink,
      totalSlots,
      availableSlots: totalSlots,
      doctorId: doctor.id,
    },
    include: {
      doctor: {
        select: {
          name: true,
          email: true,
          contactNumber: true,
        },
      },
    },
  });

  return updatedSchedule;
};

// Publish Schedule
const publishSchedule = async (scheduleId: string, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId, doctorId: doctor.id },
  });

  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
  }

  if (schedule.status === ScheduleStatus.PUBLISHED) {
    throw new AppError(httpStatus.CONFLICT, "Schedule Is Already Published");
  }

  const publishedSchedule = await prisma.schedule.update({
    where: { id: schedule.id },
    data: { status: ScheduleStatus.PUBLISHED },
  });

  return publishedSchedule;
};

// Delete Schedule
const deleteSchedule = async (scheduleId: string, user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId, doctorId: doctor.id },
  });

  if (!schedule || schedule.isDeleted) {
    throw new AppError(httpStatus.NOT_FOUND, "Schedule Not Found");
  }

  if (
    schedule.status === ScheduleStatus.PUBLISHED &&
    schedule.totalSlots !== schedule.availableSlots
  ) {
    throw new AppError(
      httpStatus.CONFLICT,
      "Schedule Once Published And Appointement Booked Cannot Be Deleted",
    );
  }

  const deletedSchedule = await prisma.schedule.update({
    where: { id: schedule.id },
    data: { isDeleted: true, deletedAt: new Date() },
  });

  return deletedSchedule;
};

// Get Today's Schedule
const getTodaysSchedules = async (query: IQuery) => {
  if (!query.doctorId) {
    throw new AppError(
      httpStatus.NOT_FOUND,
      "Doctor Id Must Be Provided In Query",
    );
  }

  const doctor = await prisma.doctor.findUnique({
    where: { id: query.doctorId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  const limit = query.limit ? Number(query.limit) : 10;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy ? query.sortBy : "createdAt";
  const sortOrder = query.sortOrder ? query.sortOrder : "desc";

  const now = new Date();
  const startOfToday = startOfDay(now);
  const startOfTomorrow = addDays(startOfToday, 1);

  const andConditions: ScheduleWhereInput[] = [
    {
      doctorId: query.doctorId,
    },
    {
      isDeleted: false,
    },
    {
      status: ScheduleStatus.PUBLISHED,
    },
    {
      startDateTime: {
        gte: startOfToday,
        lt: startOfTomorrow,
        gt: now,
      },
    },
    {
      availableSlots: { gt: 0 },
    },
  ];

  const schedules = await prisma.schedule.findMany({
    where: {
      AND: andConditions,
    },

    take: limit,
    skip,
    orderBy: {
      // sortBy : sortOrder
      [sortBy]: sortOrder,
    },
  });

  const total = await prisma.schedule.count({ where: { AND: andConditions } });

  return {
    data: schedules,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const ScheduleServices = {
  createSchedule,
  getMySchedules,
  getAllSchedules,
  getScheduleById,
  updateSchedule,
  publishSchedule,
  deleteSchedule,
  getTodaysSchedules,
};
