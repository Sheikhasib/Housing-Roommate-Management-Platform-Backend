/** biome-ignore-all lint/style/useConst: <explanation> */
/** biome-ignore-all assist/source/organizeImports: <explanation> */
/** biome-ignore-all lint/style/useImportType: <explanation> */
import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import {
  AuthProvider,
  Role,
  UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { jwtUtils } from "../../utils/jwt";
import type {
  IForgotPasswordPayload,
  IGoogleLoginPayload,
  ILoginUserPayload,
  IRegisterPatientPayload,
  IRequestUser,
  IResetPasswordPayload,
  IVerifyEmailPayload,
} from "./auth.interface";
import { TokenPayload } from "google-auth-library";
import { googleClient } from "../../lib/googleAuth";
import crypto from "crypto";
import { redisClient } from "../../lib/redis";
import { transporter } from "../../lib/nodemailer";
import ejs from "ejs";
import path from "path";
import { AppError } from "../../utils/AppError";
import httpStatus from "http-status";

// Register Patient
const registerPatient = async (payload: IRegisterPatientPayload) => {
  const { name, password, patient: patientData } = payload;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (isUserExists) {
    throw new AppError(httpStatus.CONFLICT, "User with this email already exists");
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  // Setting the "key" for redis
  const otpKey = `patient-registration-otp:${email}`;

  // Generate a random 6-digit OTP / "value"
  const otpValue = crypto.randomInt(100000, 1000000).toString(); // convert to string because redis only accepts string

  const expirationSeconds = 5 * 60; // 5 minutes of expiration

  // Patient Registration OTP
  await redisClient.set(otpKey, otpValue, {
    expiration: {
      type: "EX", // Expiration type ("EX" for seconds, "PX" for milliseconds)
      value: expirationSeconds, // 5 minutes of expiration
    },
  });

  const patientRegistrationData = `patient-registration-data:${email}`;

  const redisUserDataPayload = {
    name,
    email,
    password: hashedPassword,
    patient: patientData,
  };

  // Patient Registration Data
  await redisClient.set(
    patientRegistrationData,
    JSON.stringify(redisUserDataPayload), // convert to string because redis only accepts string
    {
      expiration: {
        type: "EX", // Expiration type ("EX" for seconds, "PX" for milliseconds)
        value: expirationSeconds, // 5 minutes of expiration
      },
    },
  );

  // Render the OTP template using EJS library
  const templatePath = path.join(
    process.cwd(), // Get the current working directory
    "src/app/templates/registration-user-otp.ejs", // path to the template file
  );

  const templateData = {
    name,
    email,
    otp: otpValue,
    expirationMinutes: expirationSeconds / 60, // 5 minutes
  };

  // Render the OTP template
  const html = await ejs.renderFile(templatePath, templateData);

  // Send the OTP via email to the user using Nodemailer library
  await transporter.sendMail({
    from: config.smtp_user,
    to: email,
    subject: "Email Verification OTP",
    // text: `Your OTP for password reset is: ${otp}`,
    // html: `<h1>Your OTP for password reset is: <b>${otp}</b></h1>`,
    html,
  });

  /*
  const createdUser = await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      patient: {
        create: { name, email, contactNumber: patientData?.contactNumber },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  const { patient, ...user } = createdUser;
  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
  */
};

// Verify Patient Email
const verifyPatientEmail = async (payload: IVerifyEmailPayload) => {
  const otp = payload.otp;
  const email = payload.email.trim().toLowerCase();

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  // if (isUserExists) {
  //   throw new Error("User with this email already exists");
  // }

  if (isUserExists?.status === UserStatus.BLOCKED) {
    throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
  }

  if (isUserExists?.emailVerified) {
    throw new AppError(httpStatus.CONFLICT, "Email is already verified");
  }

  if (isUserExists?.isDeleted || isUserExists?.status === UserStatus.DELETED) {
    throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
  }

  // Setting the "key" for redis
  const otpKey = `patient-registration-otp:${email}`;

  // Get the OTP from Redis
  const redisOTP = await redisClient.get(otpKey);

  // If the OTP is not found, throw an error
  if (!redisOTP) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  // If the OTP does not match with user input, throw an error
  if (redisOTP !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP does not match");
  }

  // Delete the OTP from Redis after verification
  await redisClient.del(otpKey);

  // Then Get the user data from Redis
  const patientRegistrationData = `patient-registration-data:${email}`;

  const redisPatientData = await redisClient.get(patientRegistrationData);

  if (!redisPatientData) {
    throw new AppError(httpStatus.NOT_FOUND, "Patient data not found");
  }

  const patientPayload: IRegisterPatientPayload = JSON.parse(redisPatientData);

  const createdUser = await prisma.user.create({
    data: {
      name: patientPayload.name,
      email: patientPayload.email,
      password: patientPayload.password,
      role: Role.PATIENT,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      patient: {
        create: {
          name: patientPayload.name,
          email: patientPayload.email,
          contactNumber: patientPayload?.patient?.contactNumber || "",
        },
      },
    },
    omit: { password: true },
    include: { patient: true },
  });

  // Delete the patient data from Redis after verification
  await redisClient.del(patientRegistrationData);

  // Render the OTP template using EJS library
  const templatePath = path.join(
    process.cwd(), // Get the current working directory
    "src/app/templates/patient-welcome-email.ejs", // path to the template file
  );

  const templateData = {
    name: createdUser.name,
  };

  // Render the OTP template
  const html = await ejs.renderFile(templatePath, templateData);

  // Send the OTP via email to the user using Nodemailer library
  await transporter.sendMail({
    from: config.smtp_user,
    to: email,
    subject: "Welcome to PH Healthcare System",
    // text: `Your OTP for password reset is: ${otp}`,
    // html: `<h1>Your OTP for password reset is: <b>${otp}</b></h1>`,
    html,
  });

  const { patient, ...user } = createdUser;

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    user,
    patient,
    accessToken,
    refreshToken,
  };
};

// Login User
const loginUser = async (payload: ILoginUserPayload) => {
  const { password } = payload;
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
  }

  // Check if the user has a Google ID associated with their account
  if (user.password === null || user.googleId !== null) {
    throw new AppError(
      httpStatus.CONFLICT,
      "User already has an account registered with Google. Please use Google login.",
    );
  }

  const isPasswordMatched = await bcrypt.compare(
    password,
    user.password as string,
  );

  if (!isPasswordMatched) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid credentials");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

// Get Me
const getMe = async (user: IRequestUser) => {
  const isUserExists = await prisma.user.findUnique({
    where: {
      id: user.userId,
    },
    include: {
      patient: true,
    },
    omit: {
      password: true,
    },
  });

  if (!isUserExists) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  return isUserExists;
};

// Refresh Token
const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new AppError(
      httpStatus.UNAUTHORIZED,
      config.node_env === "development"
        ? verifiedRefreshToken.error
        : "Invalid refresh token",
    );
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: { id: data.userId },
  });

  if (!user || user.isDeleted || user.status !== UserStatus.ACTIVE) {
    throw new AppError(httpStatus.NOT_FOUND, "User is inactive or not found");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

// Google Login
const googleLogin = async (payload: IGoogleLoginPayload) => {
  let googleIdTokenPayload: TokenPayload | null | undefined = null;

  try {
    // Verify the ID token using the Google OAuth2 client
    const ticket = await googleClient.verifyIdToken({
      idToken: payload.idToken,
      audience: config.google_client_id,
    });

    // Get the payload from the verified ID token
    googleIdTokenPayload = ticket.getPayload();
  } catch (error) {
    // Log the error for debugging purposes
    console.log("Google ID Token Verification Failed", error);
    // Throw an error indicating that the ID token is invalid or expired
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or Expired Google ID token");
  }

  // Check if the payload is null or undefined
  if (!googleIdTokenPayload) {
    throw new AppError(httpStatus.UNAUTHORIZED, "Invalid or Expired Google ID token");
  }

  // Check if the payload contains the name field
  if (!googleIdTokenPayload.name) {
    throw new AppError(httpStatus.BAD_REQUEST, "Google ID token does not contain name");
  }

  // Check if the payload contains the email field
  if (!googleIdTokenPayload.email) {
    throw new AppError(httpStatus.BAD_REQUEST, "Google ID token does not contain email");
  }

  const ifPatientExistWithGoogleAuth = await prisma.user.findUnique({
    where: {
      email: googleIdTokenPayload.email,
      role: Role.PATIENT,
      googleId: googleIdTokenPayload.sub,
    },
  });

  // Check if the user exists with the provided Google ID and email
  let user = ifPatientExistWithGoogleAuth;

  if (!ifPatientExistWithGoogleAuth) {
    // Check if the user exists with the provided email and CREDENTIAL auth provider
    const ifPatientExistWithCredentials = await prisma.user.findUnique({
      where: {
        email: googleIdTokenPayload.email,
        role: Role.PATIENT,
        authProvider: AuthProvider.CREDENTIAL,
      },
    });

    if (ifPatientExistWithCredentials) {
      if (!ifPatientExistWithCredentials.emailVerified) {
        throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
      }

      if (ifPatientExistWithCredentials.status === UserStatus.BLOCKED) {
        throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
      }

      if (
        ifPatientExistWithCredentials.isDeleted ||
        ifPatientExistWithCredentials.status === UserStatus.DELETED
      ) {
        throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
      }

      user = await prisma.user.update({
        where: {
          id: ifPatientExistWithCredentials.id,
        },
        data: {
          googleId: googleIdTokenPayload.sub,
        },
      });
    } else {
      // Google Register
      // If the user doesn't exist, create a new user with the Google ID and email
      user = await prisma.user.create({
        data: {
          name: googleIdTokenPayload.name,
          email: googleIdTokenPayload.email,
          role: Role.PATIENT,
          googleId: googleIdTokenPayload.sub,
          authProvider: AuthProvider.GOOGLE,
          emailVerified: true,
          patient: {
            create: {
              name: googleIdTokenPayload.name,
              email: googleIdTokenPayload.email,
            },
          },
        },
      });

      // Render the OTP template using EJS library
      const templatePath = path.join(
        process.cwd(), // Get the current working directory
        "src/app/templates/patient-welcome-email.ejs", // path to the template file
      );

      const templateData = {
        name: user.name,
      };

      // Render the OTP template
      const html = await ejs.renderFile(templatePath, templateData);

      // Send the OTP via email to the user using Nodemailer library
      await transporter.sendMail({
        from: config.smtp_user,
        to: user.email,
        subject: "Welcome to PH Healthcare System",
        // text: `Your OTP for password reset is: ${otp}`,
        // html: `<h1>Your OTP for password reset is: <b>${otp}</b></h1>`,
        html,
      });
    }
  }

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.status === UserStatus.BLOCKED) {
    throw new AppError(httpStatus.FORBIDDEN, "User Is Blocked");
  }

  if (user.isDeleted || user.status === UserStatus.DELETED) {
    throw new AppError(httpStatus.NOT_FOUND, "User Is Deleted");
  }

  const jwtPayload = {
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  const accessToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions,
  );

  const refreshToken = jwtUtils.createToken(
    jwtPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions,
  );

  return {
    accessToken,
    refreshToken,
  };
};

// Forgot Password
const forgotPassword = async (payload: IForgotPasswordPayload) => {
  const { email } = payload;

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (!isUserExists) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (isUserExists.status === UserStatus.BLOCKED) {
    throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
  }

  if (isUserExists.emailVerified === false) {
    throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
  }

  if (isUserExists.isDeleted || isUserExists.status === UserStatus.DELETED) {
    throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
  }

  // Check if the user has a Google ID associated with their account, and if so, throw an error
  if (isUserExists.googleId && isUserExists.authProvider !== "GOOGLE") {
    throw new AppError(
      httpStatus.CONFLICT,
      "User already has an account registered with Google. Please use Google login.",
    );
  }

  // Generate a random 6-digit OTP / redis "value"
  const otp = crypto.randomInt(100000, 1000000).toString(); // convert to string because redis only accepts string

  // Setting the "key" for redis
  const key = `forgot-password-otp:${isUserExists.email}`;

  const expirationSeconds = 5 * 60; // 5 minutes of expiration

  await redisClient.set(key, otp, {
    expiration: {
      type: "EX", // Expiration type ("EX" for seconds, "PX" for milliseconds)
      value: expirationSeconds, // 5 minutes of expiration
    },
  });

  // Render the OTP template using EJS library
  const templatePath = path.join(
    process.cwd(), // Get the current working directory
    "src/app/templates/forgot-password.ejs", // path to the template file
  );

  const templateData = {
    otp,
    name: isUserExists.name,
    expirationMinutes: expirationSeconds / 60, // 5 minutes
  };

  // Render the OTP template
  const html = await ejs.renderFile(templatePath, templateData);

  // Send the OTP via email to the user using Nodemailer library
  await transporter.sendMail({
    from: config.smtp_user,
    to: isUserExists.email,
    subject: "Forgot Password Reset OTP",
    // text: `Your OTP for password reset is: ${otp}`,
    // html: `<h1>Your OTP for password reset is: <b>${otp}</b></h1>`,
    html,
  });
};

// Reset Password
const resetPassword = async (payload: IResetPasswordPayload) => {
  const { email, newPassword, otp } = payload;

  const isUserExists = await prisma.user.findUnique({
    where: { email },
  });

  if (!isUserExists) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  if (isUserExists.status === UserStatus.BLOCKED) {
    throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
  }

  if (isUserExists.emailVerified === false) {
    throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
  }

  if (isUserExists.isDeleted || isUserExists.status === UserStatus.DELETED) {
    throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
  }

  // Check if the user has a Google ID associated with their account, and if so, throw an error
  if (isUserExists.googleId && isUserExists.authProvider !== "GOOGLE") {
    throw new AppError(
      httpStatus.CONFLICT,
      "User already has an account registered with Google. Please use Google login.",
    );
  }

  const key = `forgot-password-otp:${isUserExists.email}`;

  const redisOTP = await redisClient.get(key);

  if (!redisOTP) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  if (redisOTP !== otp) {
    throw new AppError(httpStatus.BAD_REQUEST, "OTP does not match");
  }

  const hashedNewPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  // Update the password
  const updateUser = await prisma.user.update({
    where: {
      email: isUserExists.email,
    },
    data: {
      password: hashedNewPassword,
    },
  });

  // Delete the redis key
  await redisClient.del([key]);

  // Render the OTP template using EJS library
  const templatePath = path.join(
    process.cwd(), // Get the current working directory
    "src/app/templates/reset-password-success.ejs", // path to the template file
  );

  const templateData = {
    name: isUserExists.name,
  };

  // Render the OTP template
  const html = await ejs.renderFile(templatePath, templateData);

  await transporter.sendMail({
    from: config.smtp_user,
    to: isUserExists.email,
    subject: "Password Reset",
    // text: `Your password has been reset successfully.`,
    // html: `<h1>Your password has been reset successfully.</h1>`,
    html,
  });
};

export const AuthService = {
  registerPatient,
  verifyPatientEmail,
  loginUser,
  getMe,
  refreshToken,
  googleLogin,
  forgotPassword,
  resetPassword,
};
