import app from "./app";
import config from "./app/config";
import {
	expirePendingApplications,
	finalizeExpiredLeases,
	generateMonthlyRentInvoices,
	scheduleBackgroundJobs,
} from "./app/lib/cron";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import {
	seedSuperAdmin,
	seedTesterAdmin,
	seedTesterOwner,
	seedTesterManager,
	seedTesterTenant,
} from "./app/utils/seed";

const PORT = config.port;

const main = async () => {
	try {
		// 1. Database
		await prisma.$connect();
		console.log("Connected to the database successfully.");

		// 2. Redis (caching & OTP store) - the server can still boot without it,
		// but every caching/otp code path is written to fail soft. connect()
		// keeps retrying in the background (bounded strategy), so race it with
		// a timeout instead of awaiting it forever; a late rejection of the
		// connect promise is swallowed to avoid an unhandled-rejection crash.
		try {
			const connectPromise = redisClient.connect();
			connectPromise.catch(() => {});

			let bootTimeout: ReturnType<typeof setTimeout> | undefined;
			await Promise.race([
				connectPromise,
				new Promise((_resolve, reject) => {
					bootTimeout = setTimeout(
						() => reject(new Error("Redis connection timed out after 10s")),
						10_000,
					);
				}),
			]);

			clearTimeout(bootTimeout);
			console.log("Connected to Redis successfully.");
		} catch (error) {
			console.log("Redis connection failed (continuing without cache):", error);
		}

		// 3. Email transport (soft check)
		try {
			await transporter.verify();
			console.log("Nodemailer connected to Email successfully.");
		} catch (error) {
			console.log("Email transport not verified:", error);
		}

		// 4. Demo accounts (evaluator credentials)
		await seedSuperAdmin();
		await seedTesterAdmin();
		await seedTesterOwner();
		await seedTesterManager();
		await seedTesterTenant();

		// 5. Background jobs
		scheduleBackgroundJobs();

		// catch up on anything that happened while the server was offline
		await generateMonthlyRentInvoices();
		await finalizeExpiredLeases();
		await expirePendingApplications();

		app.listen(PORT, () => {
			console.log(`Server is running on port ${PORT}`);
		});
	} catch (error) {
		console.error("Error starting the server:", error);
		await prisma.$disconnect();
		process.exit(1);
	}
};

main();
