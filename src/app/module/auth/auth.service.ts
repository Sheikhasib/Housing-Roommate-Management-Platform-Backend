import bcrypt from "bcryptjs";
import type { JwtPayload, SignOptions } from "jsonwebtoken";
import crypto from "crypto";
import { TokenPayload } from "google-auth-library";
import httpStatus from "http-status";
import {
	AuthProvider,
	Role,
	UserStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import { prisma } from "../../lib/prisma";
import { googleClient } from "../../lib/googleAuth";
import { redisClient } from "../../lib/redis";
import { jwtUtils } from "../../utils/jwt";
import { AppError } from "../../utils/AppError";
import { sendTemplateEmail } from "../../utils/email";
import { createNotification } from "../../utils/notification";
import { NotificationType } from "../../../generated/prisma/enums";
import type {
	IForgotPasswordPayload,
	IGoogleLoginPayload,
	ILoginPayload,
	IRegisterPayload,
	IRequestUser,
	IResetPasswordPayload,
	IVerifyEmailPayload,
} from "./auth.interface";

const expirationSeconds = 5 * 60; // 5 minutes of expiration

// Build the JWT payload from a user row and mint fresh access/refresh tokens.
const createTokens = (user: {
	id: string;
	name: string;
	email: string;
	role: Role;
}) => {
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

	return { accessToken, refreshToken };
};

// Store the registration OTP + payload in Redis and email the OTP.
const registerUser = async (payload: IRegisterPayload) => {
	const { name, password, role } = payload;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	if (isUserExists) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User with this email already exists",
		);
	}

	const hashedPassword = await bcrypt.hash(
		password,
		Number(config.bcrypt_salt_rounds),
	);

	// Setting the "key" for redis
	const otpKey = `register-otp:${email}`;

	// Generate a random 6-digit OTP / "value"
	const otpValue = crypto.randomInt(100000, 1000000).toString();

	// Registration OTP
	await redisClient.set(otpKey, otpValue, {
		expiration: {
			type: "EX", // seconds
			value: expirationSeconds,
		},
	});

	// Stash the whole registration payload until email verification succeeds
	const registrationDataKey = `register-data:${email}`;

	const redisUserDataPayload = {
		name,
		email,
		password: hashedPassword,
		role,
		profile: payload.profile,
	};

	await redisClient.set(
		registrationDataKey,
		JSON.stringify(redisUserDataPayload),
		{
			expiration: {
				type: "EX",
				value: expirationSeconds,
			},
		},
	);

	// Render the OTP template and send it via email
	await sendTemplateEmail({
		to: email,
		subject: "Email Verification OTP - Housing & Roommate",
		template: "registration-otp",
		data: {
			name,
			email,
			otp: otpValue,
			expirationMinutes: expirationSeconds / 60,
		},
	});
};

// Verify the email OTP, then create the user (and role profile) in one go.
const verifyUserEmail = async (payload: IVerifyEmailPayload) => {
	const otp = payload.otp;
	const email = payload.email.trim().toLowerCase();

	const isUserExists = await prisma.user.findUnique({
		where: { email },
	});

	// Safety guard against re-verifying an already onboarded account
	if (isUserExists) {
		if (
			isUserExists.googleId ||
			isUserExists.authProvider === AuthProvider.GOOGLE
		) {
			throw new AppError(
				httpStatus.CONFLICT,
				"An account with this email already exists via Google. Please use Google login.",
			);
		}

		if (isUserExists.emailVerified) {
			throw new AppError(httpStatus.CONFLICT, "Email is already verified");
		}

		throw new AppError(
			httpStatus.CONFLICT,
			"An account with this email already exists. Please login instead.",
		);
	}

	const otpKey = `register-otp:${email}`;

	const redisOTP = await redisClient.get(otpKey);

	if (!redisOTP) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"OTP has expired. Please register again to receive a new OTP.",
		);
	}

	if (redisOTP !== otp) {
		throw new AppError(httpStatus.BAD_REQUEST, "OTP does not match");
	}

	// Delete the OTP after successful verification
	await redisClient.del(otpKey);

	// Pull back the registration payload
	const registrationDataKey = `register-data:${email}`;
	const redisRegistrationData = await redisClient.get(registrationDataKey);

	if (!redisRegistrationData) {
		throw new AppError(
			httpStatus.NOT_FOUND,
			"Registration data not found. Please register again.",
		);
	}

	const registrationPayload: IRegisterPayload = JSON.parse(
		redisRegistrationData,
	);

	// role default TENANT; never allow an ADMIN/SUPER_ADMIN to self-register
	const role =
		registrationPayload.role === Role.OWNER
			? Role.OWNER
			: registrationPayload.role === Role.PROPERTY_MANAGER
				? Role.PROPERTY_MANAGER
				: Role.TENANT;
	const profile = registrationPayload.profile;

	const transactionResult = await prisma.$transaction(async (tx) => {
		const createdUser = await tx.user.create({
			data: {
				name: registrationPayload.name,
				email: registrationPayload.email,
				password: registrationPayload.password,
				role,
				emailVerified: true,
				tenantProfile:
					role === Role.TENANT
						? {
								create: {
									name: registrationPayload.name,
									email: registrationPayload.email,
									contactNumber: profile?.contactNumber || "",
									gender: profile?.gender,
									occupation: profile?.occupation,
									preferredCity: profile?.preferredCity,
									monthlyBudgetMax: profile?.monthlyBudgetMax,
									smoker: profile?.smoker || false,
									petFriendly: profile?.petFriendly || false,
									lookingForRoommate: profile?.lookingForRoommate || false,
								},
							}
						: undefined,
				ownerProfile:
					role === Role.OWNER
						? {
								create: {
									name: registrationPayload.name,
									email: registrationPayload.email,
									contactNumber: profile?.contactNumber || "",
									companyName: profile?.companyName,
									address: profile?.address,
									// an owner must be manually verified by an admin before listing
									verificationStatus: "PENDING",
								},
							}
						: undefined,
				managerProfile:
					role === Role.PROPERTY_MANAGER
						? {
								create: {
									name: registrationPayload.name,
									email: registrationPayload.email,
									contactNumber: profile?.contactNumber || "",
									bio: profile?.bio,
								},
							}
						: undefined,
			},
			omit: { password: true },
			include: {
				tenantProfile: true,
				ownerProfile: true,
				managerProfile: true,
			},
		});

		return createdUser;
	});

	await redisClient.del(registrationDataKey);

	const { tenantProfile, ownerProfile, managerProfile, ...user } =
		transactionResult;
	const roleProfile =
		role === Role.TENANT
			? tenantProfile
			: role === Role.OWNER
				? ownerProfile
				: managerProfile;

	// welcome email
	await sendTemplateEmail({
		to: user.email,
		subject: `Welcome to Housing & Roommate, ${user.name}!`,
		template: "welcome",
		data: { name: user.name },
	});

	await createNotification({
		userId: user.id,
		type: NotificationType.SYSTEM,
		title: "Welcome aboard 👋",
		message: `Hi ${user.name}, your ${role === Role.TENANT ? "tenant" : role === Role.OWNER ? "owner" : "property manager"} account is ready to use.`,
	});

	const tokens = createTokens(user);

	return {
		user,
		roleProfile,
		...tokens,
	};
};

// Email + password login
const loginUser = async (payload: ILoginPayload) => {
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

	return createTokens(user);
};

// Get the logged-in user together with their role profile
const getMe = async (user: IRequestUser) => {
	const isUserExists = await prisma.user.findUnique({
		where: {
			id: user.userId,
		},
		include: {
			tenantProfile: true,
			ownerProfile: true,
			managerProfile: true,
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

// Refresh token -> new pair of tokens
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

	return createTokens(user);
};

// Google (GCP) social login - new accounts are onboarded as TENANTs
const googleLogin = async (payload: IGoogleLoginPayload) => {
	let googleIdTokenPayload: TokenPayload | null | undefined = null;

	try {
		// Verify the ID token using the Google OAuth2 client
		const ticket = await googleClient.verifyIdToken({
			idToken: payload.idToken,
			audience: config.google_client_id,
		});

		googleIdTokenPayload = ticket.getPayload();
	} catch (error) {
		console.log("Google ID Token Verification Failed", error);
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid or Expired Google ID token",
		);
	}

	if (!googleIdTokenPayload) {
		throw new AppError(
			httpStatus.UNAUTHORIZED,
			"Invalid or Expired Google ID token",
		);
	}

	if (!googleIdTokenPayload.name) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Google ID token does not contain name",
		);
	}

	if (!googleIdTokenPayload.email) {
		throw new AppError(
			httpStatus.BAD_REQUEST,
			"Google ID token does not contain email",
		);
	}

	const ifTenantExistWithGoogleAuth = await prisma.user.findUnique({
		where: {
			email: googleIdTokenPayload.email,
			googleId: googleIdTokenPayload.sub,
		},
	});

	let user = ifTenantExistWithGoogleAuth;

	if (!user) {
		// Check if a CREDENTIAL account exists with this email
		const ifTenantExistWithCredentials = await prisma.user.findUnique({
			where: {
				email: googleIdTokenPayload.email,
				authProvider: AuthProvider.CREDENTIAL,
			},
		});

		if (ifTenantExistWithCredentials) {
			if (!ifTenantExistWithCredentials.emailVerified) {
				throw new AppError(httpStatus.FORBIDDEN, "Email is not verified");
			}

			if (ifTenantExistWithCredentials.status === UserStatus.BLOCKED) {
				throw new AppError(httpStatus.FORBIDDEN, "User is blocked");
			}

			if (
				ifTenantExistWithCredentials.isDeleted ||
				ifTenantExistWithCredentials.status === UserStatus.DELETED
			) {
				throw new AppError(httpStatus.NOT_FOUND, "User is deleted");
			}

			// Link the Google account to the existing credential account
			user = await prisma.user.update({
				where: {
					id: ifTenantExistWithCredentials.id,
				},
				data: {
					googleId: googleIdTokenPayload.sub,
					emailVerified: true,
				},
			});
		} else {
			// Google Register -> onboard as TENANT with a fresh tenant profile
			user = await prisma.user.create({
				data: {
					name: googleIdTokenPayload.name,
					email: googleIdTokenPayload.email,
					role: Role.TENANT,
					googleId: googleIdTokenPayload.sub,
					authProvider: AuthProvider.GOOGLE,
					emailVerified: true,
					imageUrl: googleIdTokenPayload.picture || "",
					tenantProfile: {
						create: {
							name: googleIdTokenPayload.name,
							email: googleIdTokenPayload.email,
						},
					},
				},
			});

			await sendTemplateEmail({
				to: user.email,
				subject: `Welcome to Housing & Roommate, ${user.name}!`,
				template: "welcome",
				data: { name: user.name },
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

	return createTokens(user);
};

// Forgot Password -> send OTP
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

	// Check if the user has a Google ID associated with their account
	if (isUserExists.googleId) {
		throw new AppError(
			httpStatus.CONFLICT,
			"User already has an account registered with Google. Please use Google login.",
		);
	}

	// Generate a random 6-digit OTP
	const otp = crypto.randomInt(100000, 1000000).toString();

	const key = `forgot-password-otp:${isUserExists.email}`;

	await redisClient.set(key, otp, {
		expiration: {
			type: "EX",
			value: expirationSeconds,
		},
	});

	await sendTemplateEmail({
		to: isUserExists.email,
		subject: "Forgot Password Reset OTP - Housing & Roommate",
		template: "forgot-password",
		data: {
			otp,
			name: isUserExists.name,
			expirationMinutes: expirationSeconds / 60,
		},
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

	if (isUserExists.googleId) {
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

	await prisma.user.update({
		where: {
			email: isUserExists.email,
		},
		data: {
			password: hashedNewPassword,
		},
	});

	// Delete the redis key after password reset
	await redisClient.del([key]);

	await sendTemplateEmail({
		to: isUserExists.email,
		subject: "Password Reset Successful - Housing & Roommate",
		template: "reset-password-success",
		data: { name: isUserExists.name },
	});
};

export const AuthService = {
	registerUser,
	verifyUserEmail,
	loginUser,
	getMe,
	refreshToken,
	googleLogin,
	forgotPassword,
	resetPassword,
};
