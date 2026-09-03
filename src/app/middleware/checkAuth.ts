import type { NextFunction, Request, Response } from "express";
import type { JwtPayload } from "jsonwebtoken";
import httpStatus from "http-status";
import type { Role } from "../../generated/prisma/enums";
import config from "../config";
import { prisma } from "../lib/prisma";
import { catchAsync } from "../utils/catchAsync";
import { AppError } from "../utils/AppError";
import { jwtUtils } from "../utils/jwt";

export interface RequestUser {
	email: string;
	name: string;
	userId: string;
	role: Role;
}

declare global {
	namespace Express {
		interface Request {
			user?: RequestUser;
		}
	}
}

// auth(Role.TENANT, Role.OWNER)
// auth() => no role is required, just a valid logged in user
export const auth = (...requiredRoles: Role[]) => {
	return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
		const token = req.cookies.accessToken
			? req.cookies.accessToken
			: req.headers.authorization?.startsWith("Bearer ")
				? req.headers.authorization?.split(" ")[1]
				: req.headers.authorization;

		if (!token) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"You are not logged in. Please log in to access this resource.",
			);
		}

		const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

		if (!verifiedToken.success) {
			throw new AppError(httpStatus.UNAUTHORIZED, verifiedToken.error);
		}

		const { email, name, userId, role } = verifiedToken.data as JwtPayload;

		if (requiredRoles.length && !requiredRoles.includes(role)) {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"Forbidden. You don't have permission to access this resource.",
			);
		}

		const user = await prisma.user.findUnique({
			where: {
				id: userId,
				email,
				name,
				role,
			},
		});

		if (!user) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"User not found. Please log in again.",
			);
		}

		if (user.status === "BLOCKED") {
			throw new AppError(
				httpStatus.FORBIDDEN,
				"Your account has been blocked. Please contact support.",
			);
		}

		if (user.isDeleted || user.deletedAt) {
			throw new AppError(
				httpStatus.UNAUTHORIZED,
				"Your account has been deleted.",
			);
		}

		req.user = {
			email,
			name,
			userId,
			role,
		};

		next();
	});
};

// optionalAuth() — for public endpoints that return a richer view to signed-in
// owners/admins (e.g. property/room detail incl. drafts). A missing, invalid
// or stale token NEVER rejects the request: the caller is simply treated as a
// guest. Identity is checked on id + email + role only (not the display name,
// which can change at any time and must not silently downgrade tokens).
export const optionalAuth = catchAsync(
	async (req: Request, _res: Response, next: NextFunction) => {
		const token = req.cookies.accessToken
			? req.cookies.accessToken
			: req.headers.authorization?.startsWith("Bearer ")
				? req.headers.authorization?.split(" ")[1]
				: req.headers.authorization;

		if (!token) {
			return next();
		}

		const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

		if (!verifiedToken.success) {
			return next();
		}

		const { email, name, userId, role } = verifiedToken.data as JwtPayload;

		const user = await prisma.user.findUnique({
			where: { id: userId },
		});

		// blocked / deleted / stale-token users get the guest view
		if (
			!user ||
			user.email !== email ||
			user.role !== role ||
			user.status === "BLOCKED" ||
			user.isDeleted ||
			user.deletedAt
		) {
			return next();
		}

		req.user = {
			email,
			name,
			userId,
			role,
		};

		next();
	},
);
