import z, { email } from "zod";

const PatientRegisterZodSchema = z.object({
  name: z
    .string("Not a string.")
    .min(3, "Name must be at least 3 characters long")
    .max(15, "Name must be at most 15 characters long"),
  email: z.email("Not a valid email address."),
  password: z
    .string()
    .min(4, "Password must be at least 4 characters long")
    .max(32, "Password must be at most 32 characters long")
    .regex(/[A-Z]/, {
      message: "Password must contain at least one uppercase letter",
    })
    .regex(/[a-z]/, {
      message: "Password must contain at least one lowercase letter",
    })
    .regex(/[0-9]/, { message: "Password must contain at least one digit" })
    .regex(/[^A-Za-z0-9]/, {
      message: "Password must contain at least one special character",
    }),
  patient: z
    .object({
      contactNumber: z.string("Not a string.").optional(),
    })
    .optional(),
});

const verifyPatientZodSchema = z.object({
  email: z.email("Not a valid email address."),
  otp: z.string().length(6),
});

const LoginZodSchema = z.object({
  email: z.email("Not a valid email address."),
  password: z
    .string()
    .min(4, "Password must be at least 4 characters long")
    .max(32, "Password must be at most 32 characters long")
    .regex(/[A-Z]/, {
      message: "Password must contain at least one uppercase letter",
    })
    .regex(/[a-z]/, {
      message: "Password must contain at least one lowercase letter",
    })
    .regex(/[0-9]/, { message: "Password must contain at least one digit" })
    .regex(/[^A-Za-z0-9]/, {
      message: "Password must contain at least one special character",
    }),
});

const ForgotPasswordZodSchema = z.object({
  email: z.email("Not a valid email address."),
});

const ResetPasswordZodSchema = z.object({
  email: z.email("Not a valid email address."),
  newPassword: z
    .string()
    .min(4, "Password must be at least 4 characters long")
    .max(32, "Password must be at most 32 characters long")
    .regex(/[A-Z]/, {
      message: "Password must contain at least one uppercase letter",
    })
    .regex(/[a-z]/, {
      message: "Password must contain at least one lowercase letter",
    })
    .regex(/[0-9]/, { message: "Password must contain at least one digit" })
    .regex(/[^A-Za-z0-9]/, {
      message: "Password must contain at least one special character",
    }),
  otp: z.string().length(6),
});

export const AuthValidation = {
  PatientRegisterZodSchema,
  verifyPatientZodSchema,
  LoginZodSchema,
  ForgotPasswordZodSchema,
  ResetPasswordZodSchema,
};
