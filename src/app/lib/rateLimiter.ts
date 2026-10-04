import { rateLimit } from "express-rate-limit";

// A tight limiter for sensitive auth endpoints (register/login/otp/reset) to
// prevent brute-force attacks and OTP guessing.
export const authRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: 429,
		message:
			"Too many authentication attempts. Please try again after 15 minutes.",
		errors: [{ message: "Rate limit exceeded for authentication endpoints" }],
	},
});

// A tight limiter for the public contact form so a single client cannot flood
// the inbox with messages.
export const contactRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 5,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: 429,
		message: "Too many messages sent. Please try again after 15 minutes.",
		errors: [{ message: "Rate limit exceeded for contact messages" }],
	},
});

// A general API limiter applied to every other route.
export const generalRateLimiter = rateLimit({
	windowMs: 15 * 60 * 1000, // 15 minutes
	limit: 300,
	standardHeaders: true,
	legacyHeaders: false,
	message: {
		success: false,
		statusCode: 429,
		message: "Too many requests. Please slow down and try again later.",
		errors: [{ message: "Rate limit exceeded" }],
	},
});
