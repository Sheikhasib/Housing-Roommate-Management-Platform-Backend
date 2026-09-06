import express from "express";
import app from "../src/app";
import { redisClient } from "../src/app/lib/redis";

let bootPromise: Promise<unknown> | null = null;

// Connect Redis once per serverless instance (fail-soft): instances are
// ephemeral on Vercel, so there is no always-on boot step like server.ts.
const ensureRedisConnected = () => {
	if (!bootPromise) {
		bootPromise = redisClient.connect().catch((error) => {
			console.error("Redis connect failed on serverless boot:", error);
		});
	}

	return bootPromise;
};

// Start the handshake during cold start so the first OTP/token call is fast.
void ensureRedisConnected();

// Vercel executes this file as the serverless function. The wrapper awaits the
// (already resolved) Redis handshake, then delegates to the full Express app.
// Notifications, seeds and node-cron are intentionally NOT run here - they are
// handled by scripts/seed.ts and the Vercel Cron job (/api/cron/daily).
const serverlessApp = express();

serverlessApp.use(async (_req, _res, next) => {
	await ensureRedisConnected();
	next();
});

serverlessApp.use(app);

export const config = { maxDuration: 60 };

export default serverlessApp;
