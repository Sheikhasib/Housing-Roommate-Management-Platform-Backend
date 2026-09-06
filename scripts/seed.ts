import { prisma } from "../src/app/lib/prisma";
import {
	seedSuperAdmin,
	seedTesterAdmin,
	seedTesterManager,
	seedTesterOwner,
	seedTesterTenant,
} from "../src/app/utils/seed";

// One-shot seeding for hosted databases (Vercel/Neon). Local `npm run dev`
// already seeds on boot, but serverless instances never boot - so run this
// once against the production DATABASE_URL after applying migrations.
const run = async () => {
	await seedSuperAdmin();
	await seedTesterAdmin();
	await seedTesterOwner();
	await seedTesterManager();
	await seedTesterTenant();
	console.log("Demo accounts seeded successfully.");
};

run()
	.catch((error) => {
		console.error("Seeding failed:", error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
