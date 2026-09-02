import {
  AppointmentStatus,
  DoctorVerificationStatus,
  PaymentStatus,
  ScheduleStatus,
} from "../../../generated/prisma/enums";
import { prisma } from "../../lib/prisma";
import { RequestUser } from "../../middleware/checkAuth";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";

// Get Admin Analytics
const getAdminAnalytics = async () => {
  //total doctors(approved, pending, rejected)
  const totalDoctors = await prisma.doctor.count({
    where: {
      isDeleted: false,
    },
  });

  const totalPendingDoctorApplications = await prisma.doctor.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.PENDING,
    },
  });

  const totalApprovedDoctors = await prisma.doctor.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.APPROVED,
    },
  });

  const totalRejectedDoctors = await prisma.doctor.count({
    where: {
      isDeleted: false,
      verificationStatus: DoctorVerificationStatus.REJECTED,
    },
  });

  // total patients
  const totalPatients = await prisma.patient.count({
    where: { isDeleted: false },
  });

  // total appointments (completed, cancelled)
  const totalAppointments = await prisma.appointment.count();

  const totalCompletedAppointments = await prisma.appointment.count({
    where: { status: AppointmentStatus.COMPLETED },
  });

  const totalCancelledAppointments = await prisma.appointment.count({
    where: { status: AppointmentStatus.CANCELLED },
  });

  // total refunded result
  const totalRefundResult = await prisma.payment.aggregate({
    where: {
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  // total refunded amount
  const totalRefunded = totalRefundResult._sum.amount?.toNumber() || 0;

  // total revenue result
  const totalRevenueResult = await prisma.payment.aggregate({
    where: {
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  // total revenue
  const totalRevenue =
    (totalRevenueResult._sum.amount?.toNumber() || 0) - totalRefunded;

  return {
    totalDoctors,
    totalPendingDoctorApplications,
    totalApprovedDoctors,
    totalRejectedDoctors,
    totalPatients,
    totalAppointments,
    totalCompletedAppointments,
    totalCancelledAppointments,
    totalRevenue,
    totalRefunded,
  };
};

// Get Patient Analytics
const getPatientAnalytics = async (user: RequestUser) => {
  const patient = await prisma.patient.findUnique({
    where: { userId: user.userId },
  });

  if (!patient) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient Profile Not Found");
  }

  // total appointments (confirmed, completed, cancelled)
  const totalAppointments = await prisma.appointment.count({
    where: { patientId: patient.id },
  });

  const upcomingAppointments = await prisma.appointment.count({
    where: { patientId: patient.id, status: AppointmentStatus.CONFIRMED },
  });

  const completedAppointments = await prisma.appointment.count({
    where: { patientId: patient.id, status: AppointmentStatus.COMPLETED },
  });

  const cancelledAppointments = await prisma.appointment.count({
    where: { patientId: patient.id, status: AppointmentStatus.CANCELLED },
  });

  // total amount spent result
  const totalAmountSpentResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        patientId: patient.id,
      },
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  // total amount spent
  const totalAmountSpent = totalAmountSpentResult._sum.amount?.toNumber() || 0;

  // total refunded result
  const totalRefundedResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        patientId: patient.id,
      },
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  // total refunded
  const totalRefunded = totalRefundedResult._sum.amount?.toNumber() || 0;

  return {
    totalAppointments,
    upcomingAppointments,
    completedAppointments,
    cancelledAppointments,
    totalAmountSpent,
    totalRefunded,
  };
};

// Get Doctor Analytics
const getDoctorAnalytics = async (user: RequestUser) => {
  const doctor = await prisma.doctor.findUnique({
    where: { userId: user.userId },
  });

  if (!doctor) {
    throw new AppError(httpStatus.NOT_FOUND, "Doctor Profile Not Found");
  }

  // total schedules
  const totalSchedules = await prisma.schedule.count({
    where: { doctorId: doctor.id, isDeleted: false },
  });

  // total published schedules
  const publishedSchedules = await prisma.schedule.count({
    where: {
      doctorId: doctor.id,
      isDeleted: false,
      status: ScheduleStatus.PUBLISHED,
    },
  });

  // total appointments (confirmed, ongoing, completed, cancelled)
  const totalAppointments = await prisma.appointment.count({
    where: { doctorId: doctor.id },
  });

  const upcomingAppointments = await prisma.appointment.count({
    where: { doctorId: doctor.id, status: AppointmentStatus.CONFIRMED },
  });

  const ongoingAppointments = await prisma.appointment.count({
    where: { doctorId: doctor.id, status: AppointmentStatus.ONGOING },
  });

  const completedAppointments = await prisma.appointment.count({
    where: { doctorId: doctor.id, status: AppointmentStatus.COMPLETED },
  });

  const cancelledAppointments = await prisma.appointment.count({
    where: { doctorId: doctor.id, status: AppointmentStatus.CANCELLED },
  });

  // total refunded payments result
  const totalDoctorRefundedResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        doctorId: doctor.id,
      },
      status: PaymentStatus.REFUNDED,
    },
    _sum: {
      amount: true,
    },
  });

  // total refunded
  const totalDoctorRefunded =
    totalDoctorRefundedResult._sum.amount?.toNumber() || 0;

  // total doctor earnings result
  const totalDoctorEarningsResult = await prisma.payment.aggregate({
    where: {
      appointment: {
        doctorId: doctor.id,
      },
      status: PaymentStatus.PAID,
    },
    _sum: {
      amount: true,
    },
  });

  // total doctor earnings
  const totalDoctorEarnings =
    (totalDoctorEarningsResult._sum.amount?.toNumber() || 0) -
    totalDoctorRefunded;

  return {
    totalSchedules,
    publishedSchedules,
    totalAppointments,
    upcomingAppointments,
    ongoingAppointments,
    completedAppointments,
    cancelledAppointments,
    totalDoctorEarnings,
    totalDoctorRefunded,
  };
};

export const AnalyticsServices = {
  getAdminAnalytics,
  getPatientAnalytics,
  getDoctorAnalytics,
};
