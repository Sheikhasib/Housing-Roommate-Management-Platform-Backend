import type { Request, Response } from "express";
import httpStatus from "http-status";
import config from "../../config";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import { AppError } from "../../utils/AppError";
import type { IRequestUser } from "./auth.interface";
import { AuthService } from "./auth.service";

const cookieOptions = {
	httpOnly: true,
	secure: config.node_env === "production",
	sameSite: "none" as const,
};

const setAuthCookies = (
	res: Response,
	accessToken: string,
	refreshToken: string,
) => {
	res.cookie("accessToken", accessToken, {
		...cookieOptions,
		maxAge: 1000 * 60 * 60 * 24, // 24 hours / 1 day
	});
	res.cookie("refreshToken", refreshToken, {
		...cookieOptions,
		maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
	});
};

// Register route -> sends a verification OTP to the email
const registerUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.registerUser(payload);

	sendResponse(res, {
		statusCode: httpStatus.CREATED,
		success: true,
		message: "Verification OTP sent successfully",
		data: null,
	});
});

// Verify Email route -> creates the account & returns tokens
const verifyUserEmail = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.verifyUserEmail(payload);

	const { accessToken, refreshToken, user, roleProfile } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Email verified successfully",
		data: {
			accessToken,
			refreshToken,
			user,
			roleProfile,
		},
	});
});

// Login route
const loginUser = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;
	const result = await AuthService.loginUser(payload);
	const { accessToken, refreshToken } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged in successfully",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

// Logout route -> clears the auth cookies
const logoutUser = catchAsync(async (_req: Request, res: Response) => {
	res.clearCookie("accessToken", cookieOptions);
	res.clearCookie("refreshToken", cookieOptions);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User logged out successfully",
		data: null,
	});
});

// Get Me route
const getMe = catchAsync(async (req: Request, res: Response) => {
	const user = req.user as unknown as IRequestUser;

	if (!user) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"User information is missing in the request",
		);
	}

	const result = await AuthService.getMe(user);
	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "User profile fetched successfully",
		data: result,
	});
});

// Refresh Token
const refreshToken = catchAsync(async (req: Request, res: Response) => {
	if (!req.cookies.refreshToken) {
		throw new AppError(httpStatus.UNAUTHORIZED, "Refresh token is missing");
	}
	const result = await AuthService.refreshToken(req.cookies.refreshToken);
	const { accessToken, refreshToken: newRefreshToken } = result;

	setAuthCookies(res, accessToken, newRefreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "New tokens generated successfully",
		data: {
			accessToken,
			refreshToken: newRefreshToken,
		},
	});
});

// Google Login
const googleLogin = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	const result = await AuthService.googleLogin(payload);
	const { accessToken, refreshToken } = result;

	setAuthCookies(res, accessToken, refreshToken);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Google login successful",
		data: {
			accessToken,
			refreshToken,
		},
	});
});

// Forgot Password
const forgotPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.forgotPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: `OTP sent to Email: ${payload.email}`,
		data: null,
	});
});

// Reset Password
const resetPassword = catchAsync(async (req: Request, res: Response) => {
	const payload = req.body;

	await AuthService.resetPassword(payload);

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Password reset successfully",
		data: null,
	});
});

export const AuthController = {
	registerUser,
	verifyUserEmail,
	loginUser,
	logoutUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
