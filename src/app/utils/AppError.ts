export class AppError extends Error {
	public statusCode: number;

	// Optional list of field-specific issues so the error handler can return a
	// structured `errors` array (field + message) instead of a flat message.
	public issues?: { field?: string; message: string }[];

	constructor(
		statusCode: number,
		message: string,
		stack = "",
		issues?: { field?: string; message: string }[],
	) {
		super(message); // throw new Error(message)

		this.statusCode = statusCode;
		this.issues = issues;

		// Custom stack trace(optional)
		if (stack) {
			this.stack = stack;
		} else {
			Error.captureStackTrace(this, this.constructor);
		}
	}
}

//throw new AppError(404, "Not Found")
