import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import {
  emailSchema,
  loginSchema,
  passwordResetSchema,
  schemaError,
  signupSchema,
  verificationSchema,
} from './auth.schemas';

const validSignup = {
  email: ' Person@Example.COM ',
  username: 'Person_1',
  password: 'secure123',
  fullName: 'Person Example',
  phone: '+992 900 00 00 00',
};

describe('auth request schemas', () => {
  it('normalizes signup identifiers at the API boundary', () => {
    const parsed = signupSchema.parse(validSignup);
    expect(parsed.email).toBe('person@example.com');
    expect(parsed.username).toBe('person_1');
  });

  it('rejects weak signup passwords', () => {
    expect(signupSchema.safeParse({ ...validSignup, password: 'onlyletters' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, password: '12345678' }).success).toBe(false);
  });

  it('rejects malformed usernames and phone numbers', () => {
    expect(signupSchema.safeParse({ ...validSignup, username: 'bad-name' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, phone: 'abc' }).success).toBe(false);
  });

  it('bounds every user-controlled identity field', () => {
    expect(signupSchema.safeParse({ ...validSignup, email: `${'a'.repeat(250)}@example.com` }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...validSignup, username: 'a'.repeat(33) }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, password: `Secure1${'x'.repeat(122)}` }).success).toBe(
      false,
    );
    expect(signupSchema.safeParse({ ...validSignup, fullName: 'A'.repeat(121) }).success).toBe(false);
    expect(signupSchema.safeParse({ ...validSignup, phone: `+${'1'.repeat(33)}` }).success).toBe(false);
    expect(loginSchema.safeParse({ email: validSignup.email, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });

  it('requires login credentials', () => {
    expect(loginSchema.safeParse({ email: 'person@example.com', password: '' }).success).toBe(false);
  });

  it('accepts only six-digit verification codes', () => {
    expect(verificationSchema.safeParse({ email: 'person@example.com', code: '123456' }).success).toBe(true);
    expect(verificationSchema.safeParse({ email: 'person@example.com', code: '12345x' }).success).toBe(false);
  });

  it('validates email-only requests', () => {
    expect(emailSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('validates complete password reset requests', () => {
    expect(
      passwordResetSchema.safeParse({ email: 'person@example.com', code: '123456', password: 'changed123' })
        .success,
    ).toBe(true);
  });

  it('returns the first schema issue or a safe fallback', () => {
    const invalid = emailSchema.safeParse({ email: 'invalid' });
    expect(invalid.success).toBe(false);
    if (!invalid.success) expect(schemaError(invalid.error)).toBe('Enter a valid email address.');
    expect(schemaError(new ZodError([]))).toBe('Check the submitted values and try again.');
  });
});
