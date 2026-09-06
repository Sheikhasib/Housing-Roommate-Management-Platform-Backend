import {
	Router,
	type NextFunction,
	type Request,
	type Response,
} from "express";
import httpStatus from "http-status";
import config from "../../config";
import {
	expirePendingApplications,
	finalizeExpiredLeases,
	generateMonthlyRentInvoices,
	reconcileStaleProcessingPayments,
} from "../../lib/cron";
import { AppError } from "../../utils/AppError";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";

// Guard the cron endpoint: Vercel Cron attaches `Authorization: Bearer
// <CRON_SECRET>` when the env var is set. When CRON_SECRET is unset (plain
// local dev) the endpoint stays open so the jobs can be triggered manually.
const requireCronSecret = (
	req: Request,
	_res: Response,
	next: NextFunction,
) => {
	const secret = config.cron_secret;

	if (secret && req.get("authorization") !== `Bearer ${secret}`) {
		next(new AppError(httpStatus.FORBIDDEN, "Invalid cron secret"));
		return;
	}

	next();
};

// Runs every daily background job in sequence. Vercel Cron calls this with a
// GET request; on a long-running host the boot scheduler already runs the same
// jobs, so triggering it manually is safe (every job is idempotent).
const runDailyJobs = catchAsync(async (_req: Request, res: Response) => {
	const jobs: { name: string; run: () => Promise<void> }[] = [
		{ name: "rent invoices", run: generateMonthlyRentInvoices },
		{ name: "lease finalizer", run: finalizeExpiredLeases },
		{ name: "application expiry", run: expirePendingApplications },
		{ name: "payment reconciliation", run: reconcileStaleProcessingPayments },
	];

	const results: { job: string; ok: boolean }[] = [];

	for (const job of jobs) {
		try {
			await job.run();
			results.push({ job: job.name, ok: true });
		} catch (error) {
			console.error(`Cron job "${job.name}" failed:`, error);
			results.push({ job: job.name, ok: false });
		}
	}

	sendResponse(res, {
		statusCode: httpStatus.OK,
		success: true,
		message: "Daily cron jobs executed",
		data: results,
	});
});

const router = Router();

router.get("/daily", requireCronSecret, runDailyJobs);

export const CronRoutes = router;
