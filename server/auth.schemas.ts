import { z } from 'zod';

const email = z
  .string({ required_error: 'Enter a valid email address.' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.');

const password = z
  .string({ required_error: 'Enter a password.' })
  .min(8, 'Password must be at least 8 characters and include a letter and a number.')
  .regex(/[A-Za-z]/, 'Password must be at least 8 characters and include a letter and a number.')
  .regex(/\d/, 'Password must be at least 8 characters and include a letter and a number.');

export const signupSchema = z.object({
  email,
  username: z
    .string({ required_error: 'Choose a username.' })
    .trim()
    .toLowerCase()
    .min(6, 'Username must be at least 6 characters.')
    .regex(/^[a-z0-9_]+$/i, 'Use only letters, numbers, and underscore.'),
  password,
  fullName: z.string({ required_error: 'Enter your full name.' }).trim().min(2, 'Enter your full name.'),
  phone: z
    .string({ required_error: 'Enter a valid phone number.' })
    .trim()
    .transform((value) => value.replace(/\s+/g, ' '))
    .refine((value) => /^\+?[0-9][0-9\s().-]{5,}$/.test(value), 'Enter a valid phone number.'),
});

export const loginSchema = z.object({
  email,
  password: z
    .string({ required_error: 'Enter your email and password.' })
    .min(1, 'Enter your email and password.'),
});

export const verificationSchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit confirmation code.'),
});

export const emailSchema = z.object({ email });

export const passwordResetSchema = z.object({
  email,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the reset code.'),
  password,
});

export function schemaError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the submitted values and try again.';
}
