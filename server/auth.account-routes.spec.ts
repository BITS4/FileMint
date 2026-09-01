import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticate, codeHash, hashPassword, rateLimited, verifyPassword } from './auth.helpers';
import { deliverAuthCode } from './auth.email';
import { registerAccountRoutes } from './auth.account-routes';
import type { AuthDb, UserRecord } from './auth.models';
import { emptyDb, loadDb, writeDb } from './auth.store';

const state = vi.hoisted(() => ({ db: null as AuthDb | null }));

vi.mock('./auth.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.store')>();
  return {
    ...actual,
    loadDb: vi.fn(async () => state.db as AuthDb),
    writeDb: vi.fn(async () => undefined),
    mutateDb: vi.fn(async <T>(fn: (db: AuthDb) => T | Promise<T>) => fn(state.db as AuthDb)),
  };
});

vi.mock('./auth.email', () => ({
  deliverAuthCode: vi.fn(async (_context, options: { code: string }) => ({
    sent: false,
    devCode: options.code,
  })),
}));

vi.mock('./auth.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.helpers')>();
  return {
    ...actual,
    authenticate: vi.fn(),
    hashPassword: vi.fn(async (password: string) => `hash:${password}`),
    rateLimited: vi.fn(() => null),
    verifyPassword: vi.fn(async (password: string, encoded: string) => encoded === `hash:${password}`),
  };
});

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    email: 'reader@example.com',
    username: 'reader_one',
    password: 'hash:Password1',
    fullName: 'Reader One',
    phone: null,
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    premiumStatus: 'free',
    premiumStartsAt: null,
    premiumExpiresAt: null,
    lifetimePremium: false,
    currentPlanId: null,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function app() {
  const instance = new Hono();
  registerAccountRoutes(instance);
  return instance;
}

function jsonRequest(path: string, body: unknown, method = 'POST') {
  return app().request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticateAs(account: UserRecord = user()) {
  const session = {
    id: 'session-1',
    userId: account.id,
    tokenHash: 'session-hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
  };
  state.db?.users.push(account);
  state.db?.sessions.push(session);
  vi.mocked(authenticate).mockResolvedValue({ db: state.db as AuthDb, user: account, session });
  return { account, session };
}

beforeEach(() => {
  state.db = emptyDb();
  vi.clearAllMocks();
  vi.mocked(rateLimited).mockReturnValue(null);
  vi.mocked(hashPassword).mockImplementation(async (password) => `hash:${password}`);
  vi.mocked(verifyPassword).mockImplementation(async (password, encoded) => encoded === `hash:${password}`);
  vi.mocked(deliverAuthCode).mockImplementation(async (_context, options) => ({
    sent: false,
    devCode: options.code,
  }));
});

describe('account registration and verification routes', () => {
  it('checks normalized username availability and existing active users', async () => {
    state.db?.users.push(user({ username: 'reader_one' }));

    const taken = await app().request('/auth/username?username=%20Reader_One%20');
    const available = await app().request('/auth/username?username=fresh_user');

    expect(await taken.json()).toMatchObject({ valid: true, available: false });
    expect(await available.json()).toMatchObject({ valid: true, available: true });
    expect(loadDb).toHaveBeenCalledTimes(2);
  });

  it('signs up a valid account and reports provider delivery failures', async () => {
    const payload = {
      email: 'new@example.com',
      username: 'new_reader',
      password: 'Password1',
      fullName: 'New <Reader>',
      phone: '+1 555 123 4567',
    };
    const success = await jsonRequest('/auth/signup', payload);
    expect(success.status).toBe(201);
    expect(await success.json()).toMatchObject({ sent: false, devCode: expect.stringMatching(/^\d{6}$/) });
    expect(state.db?.users[0]).toMatchObject({ email: 'new@example.com', emailVerified: false });

    state.db = emptyDb();
    vi.mocked(deliverAuthCode).mockResolvedValueOnce({ sent: false, error: 'provider down' });
    const failed = await jsonRequest('/auth/signup', { ...payload, email: 'other@example.com' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ error: 'provider down' });
  });

  it('rejects duplicate signup identifiers and signup rate limits', async () => {
    state.db?.users.push(user());
    const base = {
      username: 'fresh_user',
      password: 'Password1',
      fullName: 'Reader',
      phone: '+1 555 123 4567',
    };

    expect((await jsonRequest('/auth/signup', { ...base, email: user().email })).status).toBe(409);
    expect(
      (
        await jsonRequest('/auth/signup', {
          ...base,
          email: 'fresh@example.com',
          username: user().username,
        })
      ).status,
    ).toBe(409);
    vi.mocked(rateLimited).mockReturnValueOnce('Slow down.');
    expect(
      (
        await jsonRequest('/auth/signup', {
          ...base,
          email: 'limited@example.com',
          username: 'limited_user',
        })
      ).status,
    ).toBe(429);
  });

  it('covers verification failures, expiry, and success', async () => {
    expect(
      (await jsonRequest('/auth/verify-email', { email: 'missing@example.com', code: '123456' })).status,
    ).toBe(404);

    state.db?.users.push(user({ emailVerified: true }));
    expect((await jsonRequest('/auth/verify-email', { email: user().email, code: '123456' })).status).toBe(
      409,
    );

    state.db = emptyDb();
    state.db.users.push(user({ emailVerified: false }));
    expect((await jsonRequest('/auth/verify-email', { email: user().email, code: '123456' })).status).toBe(
      400,
    );

    state.db.codes.push({
      id: 'expired',
      email: user().email,
      purpose: 'verify_email',
      codeHash: codeHash(user().email, 'verify_email', '123456'),
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:10:00.000Z',
    });
    expect((await jsonRequest('/auth/verify-email', { email: user().email, code: '123456' })).status).toBe(
      410,
    );

    state.db.codes[0].expiresAt = '2099-01-01T00:00:00.000Z';
    const verified = await jsonRequest('/auth/verify-email', { email: user().email, code: '123456' });
    expect(verified.status).toBe(200);
    expect(state.db.users[0].emailVerified).toBe(true);
    expect(state.db.codes[0].usedAt).toBeTruthy();
  });

  it('resends codes and handles account, quota, and provider errors', async () => {
    expect((await jsonRequest('/auth/resend-code', { email: user().email })).status).toBe(404);
    state.db?.users.push(user({ emailVerified: true }));
    expect((await jsonRequest('/auth/resend-code', { email: user().email })).status).toBe(409);

    state.db = emptyDb();
    state.db.users.push(user({ emailVerified: false }));
    for (let index = 0; index < 5; index += 1) {
      state.db.codes.push({
        id: `code-${index}`,
        email: user().email,
        purpose: 'verify_email',
        codeHash: `hash-${index}`,
        createdAt: new Date().toISOString(),
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
    }
    expect((await jsonRequest('/auth/resend-code', { email: user().email })).status).toBe(429);

    state.db.codes = [];
    vi.mocked(deliverAuthCode).mockResolvedValueOnce({ sent: false, error: 'mail offline' });
    expect((await jsonRequest('/auth/resend-code', { email: user().email })).status).toBe(502);
    const sent = await jsonRequest('/auth/resend-code', { email: user().email });
    expect(sent.status).toBe(200);
    expect(await sent.json()).toHaveProperty('devCode');
  });
});

describe('account session and password routes', () => {
  it('handles missing, locked, wrong, and unverified login attempts', async () => {
    expect((await jsonRequest('/auth/login', { email: user().email, password: 'Password1' })).status).toBe(
      401,
    );

    state.db?.users.push(user({ lockedUntil: '2099-01-01T00:00:00.000Z' }));
    expect((await jsonRequest('/auth/login', { email: user().email, password: 'Password1' })).status).toBe(
      423,
    );

    state.db.users[0].lockedUntil = null;
    state.db.users[0].failedLoginAttempts = 4;
    expect((await jsonRequest('/auth/login', { email: user().email, password: 'wrong' })).status).toBe(401);
    expect(state.db.users[0].failedLoginAttempts).toBe(5);
    expect(state.db.users[0].lockedUntil).toBeTruthy();

    state.db.users[0] = user({ emailVerified: false });
    const unverified = await jsonRequest('/auth/login', { email: user().email, password: 'Password1' });
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({ emailVerificationRequired: true });

    vi.mocked(deliverAuthCode).mockResolvedValueOnce({ sent: false, error: 'mail error' });
    expect((await jsonRequest('/auth/login', { email: user().email, password: 'Password1' })).status).toBe(
      502,
    );
  });

  it('creates, reads, and revokes authenticated sessions', async () => {
    state.db?.users.push(user());
    const login = await jsonRequest('/auth/login', { email: user().email, password: 'Password1' });
    expect(login.status).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.session.token).toBeTruthy();
    expect(state.db?.sessions).toHaveLength(1);

    const noToken = await app().request('/auth/logout', { method: 'POST' });
    expect(noToken.status).toBe(200);

    const session = state.db?.sessions[0];
    const helpers = await import('./auth.helpers');
    vi.mocked(helpers.authenticate).mockResolvedValue({
      db: state.db as AuthDb,
      user: state.db?.users[0] as UserRecord,
      session: session!,
    });
    const me = await app().request('/auth/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toHaveProperty('session.warningAt');
    expect(writeDb).toHaveBeenCalled();

    await app().request('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${loginBody.session.token}` },
    });
    expect(state.db?.sessions[0].revokedAt).toBeTruthy();
  });

  it('requests password resets without exposing unknown accounts', async () => {
    const unknown = await jsonRequest('/auth/password-reset/request', { email: 'unknown@example.com' });
    expect(await unknown.json()).toEqual({ sent: true });

    state.db?.users.push(user());
    vi.mocked(deliverAuthCode).mockResolvedValueOnce({ sent: false, error: 'mail error' });
    expect((await jsonRequest('/auth/password-reset/request', { email: user().email })).status).toBe(502);
    const success = await jsonRequest('/auth/password-reset/request', { email: user().email });
    expect(success.status).toBe(200);
    expect(await success.json()).toHaveProperty('devCode');

    vi.mocked(rateLimited).mockReturnValueOnce('Too many attempts.');
    expect((await jsonRequest('/auth/password-reset/request', { email: user().email })).status).toBe(429);
  });

  it('validates and completes password resets while revoking sessions', async () => {
    expect(
      (
        await jsonRequest('/auth/password-reset/confirm', {
          email: user().email,
          code: 'bad',
          password: 'Password2',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await jsonRequest('/auth/password-reset/confirm', {
          email: user().email,
          code: '123456',
          password: 'weak',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await jsonRequest('/auth/password-reset/confirm', {
          email: user().email,
          code: '123456',
          password: 'Password2',
        })
      ).status,
    ).toBe(404);

    state.db?.users.push(user());
    expect(
      (
        await jsonRequest('/auth/password-reset/confirm', {
          email: user().email,
          code: '123456',
          password: 'Password2',
        })
      ).status,
    ).toBe(400);
    state.db?.codes.push({
      id: 'reset',
      email: user().email,
      purpose: 'password_reset',
      codeHash: codeHash(user().email, 'password_reset', '123456'),
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:10:00.000Z',
    });
    expect(
      (
        await jsonRequest('/auth/password-reset/confirm', {
          email: user().email,
          code: '123456',
          password: 'Password2',
        })
      ).status,
    ).toBe(410);

    state.db.codes[0].expiresAt = '2099-01-01T00:00:00.000Z';
    state.db.sessions.push({
      id: 'session-1',
      userId: user().id,
      tokenHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revokedAt: null,
    });
    const success = await jsonRequest('/auth/password-reset/confirm', {
      email: user().email,
      code: '123456',
      password: 'Password2',
    });
    expect(success.status).toBe(200);
    expect(state.db.users[0].password).toBe('hash:Password2');
    expect(state.db.sessions[0].revokedAt).toBeTruthy();
  });

  it('changes passwords and deletes authenticated accounts', async () => {
    const { account, session } = authenticateAs();
    expect(
      (
        await jsonRequest('/auth/change-password', {
          currentPassword: 'Password1',
          newPassword: 'weak',
        })
      ).status,
    ).toBe(400);

    state.db!.users = [];
    expect(
      (
        await jsonRequest('/auth/change-password', {
          currentPassword: 'Password1',
          newPassword: 'Password2',
        })
      ).status,
    ).toBe(404);

    state.db!.users = [account];
    expect(
      (
        await jsonRequest('/auth/change-password', {
          currentPassword: 'wrong',
          newPassword: 'Password2',
        })
      ).status,
    ).toBe(401);
    state.db!.sessions.push({ ...session, id: 'session-2', tokenHash: 'other-session' });
    const changed = await jsonRequest('/auth/change-password', {
      currentPassword: 'Password1',
      newPassword: 'Password2',
    });
    expect(changed.status).toBe(200);
    expect(state.db?.sessions.find((item) => item.id === 'session-2')?.revokedAt).toBeTruthy();

    const deleted = await app().request('/auth/account', { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(state.db?.users[0].deletedAt).toBeTruthy();
  });
});
