import { z } from 'zod';

const email = z
  .string({ required_error: 'Enter a valid email address.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email address is too long.')
  .email('Enter a valid email address.');

const password = z
  .string({ required_error: 'Enter a password.' })
  .min(8, 'Password must be at least 8 characters and include a letter and a number.')
  .max(128, 'Password must be 128 characters or fewer.')
  .regex(/[A-Za-z]/, 'Password must be at least 8 characters and include a letter and a number.')
  .regex(/\d/, 'Password must be at least 8 characters and include a letter and a number.');

export const signupSchema = z.object({
  email,
  username: z
    .string({ required_error: 'Choose a username.' })
    .trim()
    .toLowerCase()
    .min(6, 'Username must be at least 6 characters.')
    .max(32, 'Username must be 32 characters or fewer.')
    .regex(/^[a-z0-9_]+$/i, 'Use only letters, numbers, and underscore.'),
  password,
  fullName: z
    .string({ required_error: 'Enter your full name.' })
    .trim()
    .min(2, 'Enter your full name.')
    .max(120, 'Full name must be 120 characters or fewer.'),
  phone: z
    .string({ required_error: 'Enter a valid phone number.' })
    .trim()
    .transform((value) => value.replace(/\s+/g, ' '))
    .pipe(z.string().max(32, 'Phone number must be 32 characters or fewer.'))
    .refine((value) => /^\+?[0-9][0-9\s().-]{5,}$/.test(value), 'Enter a valid phone number.'),
});

export const loginSchema = z.object({
  email,
  password: z
    .string({ required_error: 'Enter your email and password.' })
    .min(1, 'Enter your email and password.')
    .max(128, 'Password must be 128 characters or fewer.'),
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
