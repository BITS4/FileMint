import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticate, rateLimited } from './auth.helpers';
import type { AuthDb, UserRecord } from './auth.models';
import { emptyDb, mutateDb } from './auth.store';
import { registerFeedbackRoutes } from './feedback';

const state = vi.hoisted(() => ({ db: null as AuthDb | null }));

vi.mock('./auth.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.store')>();
  return {
    ...actual,
    mutateDb: vi.fn(async <T>(fn: (db: AuthDb) => T | Promise<T>) => fn(state.db as AuthDb)),
  };
});

vi.mock('./auth.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.helpers')>();
  return { ...actual, authenticate: vi.fn(), rateLimited: vi.fn(() => null) };
});

const account: UserRecord = {
  id: 'user-1',
  email: 'reader@example.com',
  username: 'reader_1',
  password: { salt: 'salt', hash: 'hash' },
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  premiumStatus: 'free',
  lifetimePremium: false,
  failedLoginAttempts: 0,
};

function request(body: unknown) {
  const app = new Hono();
  registerFeedbackRoutes(app);
  return app.request('/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.db = emptyDb();
  vi.clearAllMocks();
  vi.mocked(authenticate).mockReset();
  vi.mocked(rateLimited).mockReturnValue(null);
});

describe('feedback routes', () => {
  it('requires a session and validates bounded feedback input', async () => {
    expect((await request({ type: 'feedback', message: 'Helpful idea' })).status).toBe(401);

    vi.mocked(authenticate).mockResolvedValue({ db: state.db!, user: account, session: {} as never });
    expect((await request({ type: 'other', message: 'Helpful idea' })).status).toBe(400);
    expect((await request({ type: 'feedback', message: 'x' })).status).toBe(400);
    expect(mutateDb).not.toHaveBeenCalled();
  });

  it('rate-limits requests and persists a normalized review record', async () => {
    vi.mocked(authenticate).mockResolvedValue({ db: state.db!, user: account, session: {} as never });
    vi.mocked(rateLimited).mockReturnValueOnce('Slow down.');
    expect((await request({ type: 'feature', message: '  Add batch signing  ' })).status).toBe(429);

    const response = await request({ type: 'feature', message: '  Add batch signing  ' });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, id: expect.any(String) });
    expect(state.db?.feedback).toEqual([
      expect.objectContaining({
        userId: account.id,
        type: 'feature',
        message: 'Add batch signing',
        status: 'new',
      }),
    ]);
  });
});
