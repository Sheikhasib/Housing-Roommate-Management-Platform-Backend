import { defineConfig } from "tsup";

// Produces a single self-contained ESM bundle (dist/vercel.js) that Vercel
// runs as the serverless function. The rest of the codebase uses extensionless
// ESM imports, which raw Node ESM (used by Vercel) cannot resolve - bundling
// them into one file sidesteps that. Packages stay external and resolve from
// node_modules at runtime. ESM (not CJS) is required because the generated
// Prisma client reads import.meta.url to compute its own __dirname.
export default defineConfig({
	entry: ["src/vercel.ts"],
	format: ["esm"],
	target: "node20",
	outDir: "dist",
	clean: false,
	sourcemap: false,
	splitting: false,
	esbuildOptions(options) {
		options.packages = "external";
	},
});

