import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";

// Styled PDF receipts (deposit + invoice payments). The palette mirrors the
// transactional email design (deep green + gold + cream) so the emailed PDF
// reads as the same product. Layout: full-bleed rounded header band, PAID
// status pill, amount summary card, striped detail rows, fixed footer.

const COLORS = {
	brand: "#0F5B47",
	gold: "#E8A33D",
	success: "#1D7A4F",
	mint: "#E6F3EC",
	mintSoft: "#F6F9F7",
	mintBorder: "#CFE3DB",
	ink: "#1B1712",
	body: "#4A443C",
	muted: "#A29A8C",
	label: "#7A746A",
	hairline: "#E9E3D7",
	onBrand: "#BFD9CF",
};

const CONTENT_MARGIN = 48;
const ROW_HEIGHT = 27;
const ROWS_TOP = 366;

export type TReceiptPdfField = { label: string; value: string };

export type TReceiptPdfPayload = {
	documentLabel: string;
	amount: string | number;
	amountNote: string;
	issuedAt?: Date | string | null;
	fields: TReceiptPdfField[];
};

export const formatReceiptAmount = (amount: string | number): string => {
	const numeric = Number(amount);

	if (Number.isNaN(numeric)) {
		return `BDT ${String(amount)}`;
	}

	return `BDT ${numeric.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
};

export const formatReceiptDate = (value?: Date | string | null): string => {
	if (!value) {
		return "—";
	}

	const date = value instanceof Date ? value : new Date(value);

	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	return date.toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
};

export const gatewayDisplayName = (gateway?: string | null): string => {
	switch (gateway) {
		case "BKASH":
			return "bKash";
		case "SSLCOMMERZ":
			return "SSLCommerz";
		case "STRIPE":
			return "Stripe";
		default:
			return gateway ?? "—";
	}
};

// Trim a string (with an ellipsis) so right-aligned values never overflow
// the detail column.
const fitText = (
	doc: PDFKit.PDFDocument,
	text: string,
	font: string,
	size: number,
	maxWidth: number,
): string => {
	doc.font(font).fontSize(size);

	if (doc.widthOfString(text) <= maxWidth) {
		return text;
	}

	let truncated = text;

	while (
		truncated.length > 1 &&
		doc.widthOfString(`${truncated}…`) > maxWidth
	) {
		truncated = truncated.slice(0, -1);
	}

	return `${truncated}…`;
};

export const buildReceiptPdf = async (
	payload: TReceiptPdfPayload,
): Promise<Buffer> => {
	const pdfDocument = new PDFDocument({
		size: "A4",
		margin: 0,
		info: {
			Title: `${payload.documentLabel} receipt`,
			Creator: "Housing & Roommate Management Platform",
		},
	});

	const pageWidth = pdfDocument.page.width;
	const pageHeight = pdfDocument.page.height;
	const contentWidth = pageWidth - CONTENT_MARGIN * 2;

	const pdfChunks: Buffer[] = [];
	pdfDocument.on("data", (chunk: Buffer) => pdfChunks.push(chunk));

	const pdfReadyPromise = new Promise<Buffer>((resolve) => {
		pdfDocument.on("end", () => resolve(Buffer.concat(pdfChunks)));
	});

	const writeText = (
		text: string,
		x: number,
		y: number,
		options: {
			font?: string;
			size?: number;
			color?: string;
			width?: number;
			align?: "left" | "center" | "right";
		} = {},
	) => {
		const {
			font = "Helvetica",
			size = 10,
			color = COLORS.ink,
			width,
			align = "left",
		} = options;

		pdfDocument.font(font).fontSize(size).fill(color);
		pdfDocument.text(text, x, y, {
			width,
			align,
			lineBreak: false,
		});
	};

	// Header band: the gold rect is drawn first and is slightly taller, so
	// the green band layered on top leaves a 4px gold edge that follows the
	// rounded bottom corners (top corners bleed off-page).
	pdfDocument.save();
	pdfDocument.roundedRect(0, -24, pageWidth, 158, 24).fill(COLORS.gold);
	pdfDocument.roundedRect(0, -24, pageWidth, 154, 24).fill(COLORS.brand);
	pdfDocument.restore();

	pdfDocument.save();
	pdfDocument.roundedRect(CONTENT_MARGIN, 38, 36, 36, 9).fill("#FFFFFF");
	pdfDocument.restore();

	writeText("H", CONTENT_MARGIN, 45, {
		font: "Helvetica-Bold",
		size: 19,
		color: COLORS.brand,
		width: 36,
		align: "center",
	});

	writeText("Housing & Roommate", 96, 42, {
		font: "Helvetica-Bold",
		size: 15,
		color: "#FFFFFF",
	});

	writeText("Management Platform", 96, 61, {
		size: 9.5,
		color: COLORS.onBrand,
	});

	writeText("PAYMENT RECEIPT", CONTENT_MARGIN, 38, {
		font: "Helvetica-Bold",
		size: 23,
		color: "#FFFFFF",
		width: contentWidth,
		align: "right",
	});

	writeText(payload.documentLabel.toUpperCase(), CONTENT_MARGIN, 68, {
		font: "Helvetica-Bold",
		size: 10,
		color: COLORS.gold,
		width: contentWidth,
		align: "right",
	});

	// Status pill + issue date
	pdfDocument.save();
	pdfDocument.roundedRect(CONTENT_MARGIN, 160, 78, 25, 12.5).fill(COLORS.mint);
	pdfDocument.restore();

	writeText("PAID", CONTENT_MARGIN, 167, {
		font: "Helvetica-Bold",
		size: 10.5,
		color: COLORS.success,
		width: 78,
		align: "center",
	});

	writeText("RECEIPT ISSUED", CONTENT_MARGIN, 158, {
		font: "Helvetica-Bold",
		size: 8.5,
		color: COLORS.muted,
		width: contentWidth,
		align: "right",
	});

	writeText(
		formatReceiptDate(payload.issuedAt ?? new Date()),
		CONTENT_MARGIN,
		171,
		{
			font: "Helvetica-Bold",
			size: 10.5,
			color: COLORS.ink,
			width: contentWidth,
			align: "right",
		},
	);

	// Amount summary card
	pdfDocument.save();
	pdfDocument
		.roundedRect(CONTENT_MARGIN, 202, contentWidth, 106, 14)
		.fillAndStroke(COLORS.mintSoft, COLORS.mintBorder);
	pdfDocument.restore();

	writeText("AMOUNT PAID", CONTENT_MARGIN, 222, {
		font: "Helvetica-Bold",
		size: 9.5,
		color: COLORS.success,
		width: contentWidth,
		align: "center",
	});

	writeText(formatReceiptAmount(payload.amount), CONTENT_MARGIN, 240, {
		font: "Helvetica-Bold",
		size: 30,
		color: COLORS.brand,
		width: contentWidth,
		align: "center",
	});

	writeText(payload.amountNote, CONTENT_MARGIN, 282, {
		size: 10,
		color: COLORS.body,
		width: contentWidth,
		align: "center",
	});

	// Striped detail rows
	writeText("PAYMENT DETAILS", CONTENT_MARGIN, 338, {
		font: "Helvetica-Bold",
		size: 11,
		color: COLORS.ink,
	});

	pdfDocument.save();
	pdfDocument.rect(CONTENT_MARGIN, 355, 26, 3).fill(COLORS.gold);
	pdfDocument.restore();

	// never run past the footer
	const maxRows = Math.floor((pageHeight - 90 - ROWS_TOP) / ROW_HEIGHT);
	const fields = payload.fields.slice(0, Math.max(maxRows, 0));

	fields.forEach((field, index) => {
		const rowY = ROWS_TOP + index * ROW_HEIGHT;

		if (index % 2 === 0) {
			pdfDocument.save();
			pdfDocument
				.rect(CONTENT_MARGIN, rowY, contentWidth, ROW_HEIGHT)
				.fill(COLORS.mintSoft);
			pdfDocument.restore();
		}

		writeText(field.label.toUpperCase(), CONTENT_MARGIN + 16, rowY + 9, {
			font: "Helvetica-Bold",
			size: 8.5,
			color: COLORS.label,
		});

		const value = fitText(
			pdfDocument,
			field.value,
			"Helvetica-Bold",
			10,
			contentWidth - 32 - 140,
		);

		writeText(value, CONTENT_MARGIN + 16, rowY + 8, {
			font: "Helvetica-Bold",
			size: 10,
			color: COLORS.ink,
			width: contentWidth - 32,
			align: "right",
		});
	});

	// Footer
	pdfDocument.save();
	pdfDocument
		.rect(CONTENT_MARGIN, pageHeight - 72, contentWidth, 1)
		.fill(COLORS.hairline);
	pdfDocument.restore();

	writeText(
		"Housing & Roommate Management Platform",
		CONTENT_MARGIN,
		pageHeight - 60,
		{
			font: "Helvetica-Bold",
			size: 9,
			color: COLORS.muted,
			width: contentWidth,
			align: "center",
		},
	);

	writeText(
		"System-generated receipt · no signature required",
		CONTENT_MARGIN,
		pageHeight - 46,
		{
			size: 8.5,
			color: COLORS.muted,
			width: contentWidth,
			align: "center",
		},
	);

	pdfDocument.end();
	return pdfReadyPromise;
};
