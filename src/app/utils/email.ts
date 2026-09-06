import ejs from "ejs";
import fs from "node:fs";
import path from "node:path";
import config from "../config";
import { transporter } from "../lib/nodemailer";

type TMailOptions = {
	to: string;
	subject: string;
	template: string; // name of the .ejs file inside src/app/templates
	data: Record<string, unknown>;
	attachments?: { filename: string; content: Buffer }[];
};

// Locate a template file across runtimes: local dev runs from the project
// root (cwd = repo root), while Vercel bundles the handler into a function
// whose working directory can differ - so walk up from cwd until the
// src/app/templates layout is found.
const resolveTemplatePath = (template: string) => {
	const relativePath = `src/app/templates/${template}.ejs`;

	let currentDir = process.cwd();
	for (let depth = 0; depth < 6; depth += 1) {
		const candidate = path.join(currentDir, relativePath);
		if (fs.existsSync(candidate)) {
			return candidate;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}

	throw new Error(`Email template not found: ${template}`);
};

// Render an EJS template and send it with nodemailer. Shared values
// (frontend base URL for CTA links, current year for the footer) are injected
// into every render so templates don't need them per call site.
export const sendTemplateEmail = async ({
	to,
	subject,
	template,
	data,
	attachments,
}: TMailOptions) => {
	const templatePath = resolveTemplatePath(template);

	const html = await ejs.renderFile(templatePath, {
		appUrl: config.frontend_url,
		year: new Date().getFullYear(),
		...data,
	});

	await transporter.sendMail({
		from: config.email_sender,
		to,
		subject,
		html,
		attachments,
	});
};
