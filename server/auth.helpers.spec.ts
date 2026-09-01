import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addMs,
  authResponse,
  codeHash,
  expiryFor,
  getUsage,
  hashPassword,
  isActivePremium,
  isEmail,
  isStrongPassword,
  issueCode,
  normalizeEmail,
  normalizeUsername,
  publicUser,
  rateLimited,
  syncPremium,
  tokenHash,
  validateUsername,
  verifyPassword,
} from './auth.helpers';
import type { UserRecord } from './auth.models';
import { emptyDb } from './auth.store';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    email: 'reader@example.com',
    username: 'reader_1',
    password: { salt: '00', hash: '00' },
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    premiumStatus: 'free',
    lifetimePremium: false,
    failedLoginAttempts: 0,
    ...overrides,
  };
}

describe('auth validation and security helpers', () => {
  it('normalizes identities and reports precise validation failures', () => {
    expect(normalizeEmail('  READER@Example.COM ')).toBe('reader@example.com');
    expect(normalizeUsername('  Reader_1 ')).toBe('reader_1');
    expect(validateUsername('')).toBe('Choose a username.');
    expect(validateUsername('short')).toContain('at least 6');
    expect(validateUsername('invalid-name')).toContain('only letters');
    expect(validateUsername('reader_1')).toBeNull();
    expect(isEmail('reader@example.com')).toBe(true);
    expect(isEmail('reader@example')).toBe(false);
    expect(isStrongPassword('FileMint9')).toBe(true);
    expect(isStrongPassword('password')).toBe(false);
  });

  it('hashes passwords with a random salt and compares them safely', async () => {
    const first = await hashPassword('FileMint9');
    const second = await hashPassword('FileMint9');

    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
    await expect(verifyPassword('FileMint9', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password9', first)).resolves.toBe(false);
    await expect(verifyPassword('FileMint9', { ...first, hash: '00' })).resolves.toBe(false);
  });

  it('issues expiring one-time codes without storing the plaintext', () => {
    const db = emptyDb();
    const code = issueCode(db, 'reader@example.com', 'verify_email', 'user-1');

    expect(code).toMatch(/^\d{6}$/);
    expect(db.codes).toHaveLength(1);
    expect(db.codes[0].codeHash).toBe(codeHash('reader@example.com', 'verify_email', code));
    expect(db.codes[0].codeHash).not.toContain(code);
    expect(tokenHash('secret')).toHaveLength(64);
    expect(new Date(db.codes[0].expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('keys one-time codes with a deployment secret and fails closed in production', () => {
    vi.stubEnv('FILEMINT_AUTH_CODE_PEPPER', 'a-secure-deployment-pepper-that-is-long-enough');
    const first = codeHash('READER@example.com', 'verify_email', '123456');
    expect(first).toBe(codeHash('reader@example.com', 'verify_email', '123456'));

    vi.stubEnv('FILEMINT_AUTH_CODE_PEPPER', 'a-different-deployment-pepper-long-enough');
    expect(codeHash('reader@example.com', 'verify_email', '123456')).not.toBe(first);

    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FILEMINT_AUTH_CODE_PEPPER', 'short');
    expect(() => codeHash('reader@example.com', 'verify_email', '123456')).toThrow(/32 characters/);
    vi.stubEnv('FILEMINT_AUTH_CODE_PEPPER', '');
    expect(() => codeHash('reader@example.com', 'verify_email', '123456')).toThrow(/required/);
  });

  it('ignores spoofable forwarding headers unless a trusted proxy is configured', async () => {
    const app = new Hono();
    app.get('/limit', (c) => c.text(rateLimited(c, 'signup', 'proxy-test@example.com') ?? 'ok'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.request('/limit', {
        headers: { 'x-forwarded-for': `198.51.100.${attempt}` },
      });
      expect(await response.text()).toBe('ok');
    }
    const blocked = await app.request('/limit', { headers: { 'x-forwarded-for': '203.0.113.9' } });
    expect(await blocked.text()).toMatch(/Too many attempts/);

    vi.stubEnv('FILEMINT_TRUST_PROXY', 'true');
    const proxied = await app.request('/limit', { headers: { 'x-forwarded-for': '203.0.113.10' } });
    expect(await proxied.text()).toBe('ok');
  });
});

describe('auth premium and usage helpers', () => {
  it('calculates each plan expiry and preserves lifetime access', () => {
    const start = new Date('2026-01-15T12:00:00.000Z');
    expect(expiryFor('week', start)).toBe('2026-01-22T12:00:00.000Z');
    expect(expiryFor('month', start)).toBe('2026-02-15T12:00:00.000Z');
    expect(expiryFor('year', start)).toBe('2027-01-15T12:00:00.000Z');
    expect(expiryFor('forever', start)).toBeNull();
    expect(addMs(1_000, start)).toBe('2026-01-15T12:00:01.000Z');
  });

  it('expires elapsed subscriptions while keeping lifetime users active', () => {
    const expired = user({
      premiumStatus: 'active',
      premiumExpiresAt: '2020-01-01T00:00:00.000Z',
    });
    syncPremium(expired);
    expect(expired.premiumStatus).toBe('expired');
    expect(isActivePremium(expired)).toBe(false);

    const lifetime = user({ lifetimePremium: true, premiumStatus: 'canceled' });
    expect(isActivePremium(lifetime)).toBe(true);
    expect(lifetime.premiumStatus).toBe('active');
    expect(lifetime.premiumExpiresAt).toBeNull();
  });

  it('creates one daily usage record and returns a safe public user/session shape', () => {
    const db = emptyDb();
    const record = getUsage(db, 'user-1');
    record.conversions += 1;

    expect(getUsage(db, 'user-1')).toBe(record);
    expect(db.usage).toHaveLength(1);
    expect(record).toMatchObject({ conversions: 1, ocrTasks: 0, batchJobs: 0 });

    const account = user({ fullName: 'Reader', phone: undefined });
    expect(publicUser(account)).toEqual(
      expect.objectContaining({ id: 'user-1', fullName: 'Reader', phone: null }),
    );
    expect(authResponse(account, 'token', '2026-01-01T01:00:00.000Z')).toMatchObject({
      session: { token: 'token', maxAgeSeconds: 3600 },
    });
  });
});
