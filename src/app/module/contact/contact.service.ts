import config from "../../config";
import { prisma } from "../../lib/prisma";
import { sendTemplateEmail } from "../../utils/email";
import type { ICreateContactMessagePayload } from "./contact.interface";

// Store a public contact-form message and notify the team by email.
const createContactMessage = async (payload: ICreateContactMessagePayload) => {
	const contactMessage = await prisma.contactMessage.create({
		data: {
			name: payload.name,
			email: payload.email,
			subject: payload.subject || null,
			message: payload.message,
		},
		select: { id: true },
	});

	// Fail-soft notification: the message is already stored, so a broken SMTP
	// config must never turn a public submission into an error response.
	try {
		await sendTemplateEmail({
			to: config.contact_notify_email || config.super_admin_email,
			subject: `New contact message: ${payload.subject || "No subject"}`,
			template: "contact-message",
			data: {
				name: payload.name,
				email: payload.email,
				subject: payload.subject || "N/A",
				message: payload.message,
				receivedAt: new Date().toISOString(),
			},
		});
	} catch (error) {
		console.log("Contact message notification email failed:", error);
	}

	return contactMessage;
};

export const ContactServices = {
	createContactMessage,
};
