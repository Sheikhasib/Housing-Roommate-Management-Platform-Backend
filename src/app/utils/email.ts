import ejs from "ejs";
import path from "path";
import config from "../config";
import { transporter } from "../lib/nodemailer";

type TMailOptions = {
	to: string;
	subject: string;
	template: string; // name of the .ejs file inside src/app/templates
	data: Record<string, unknown>;
	attachments?: { filename: string; content: Buffer }[];
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
	const templatePath = path.join(
		process.cwd(),
		`src/app/templates/${template}.ejs`,
	);

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
