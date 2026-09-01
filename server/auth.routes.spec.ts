import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { registerAuth } from './auth';
import { emptyDb, normalizeDb, prune } from './auth.store';

function app(): Hono {
  const instance = new Hono();
  registerAuth(instance);
  return instance;
}

describe('auth route boundaries', () => {
  it('publishes the same complete plan catalog from both public endpoints', async () => {
    const instance = app();
    const authPlans = await instance.request('/auth/plans');
    const premiumPlans = await instance.request('/premium/plans');

    expect(authPlans.status).toBe(200);
    expect(await authPlans.json()).toEqual(await premiumPlans.json());
    const repeated = await instance.request('/auth/plans');
    expect((await repeated.json()).plans).toHaveLength(4);
  });

  it('returns username validation details without consulting persistence', async () => {
    const response = await app().request('/auth/username?username=bad-name');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ username: 'bad-name', valid: false, available: false }));
  });

  it.each([
    ['/auth/signup', { email: 'bad' }],
    ['/auth/login', { email: 'bad', password: '' }],
    ['/auth/verify-email', { email: 'bad', code: '12' }],
    ['/auth/resend-code', { email: 'bad' }],
    ['/auth/password-reset/request', { email: 'bad' }],
  ])('rejects malformed input on %s', async (path, payload) => {
    const response = await app().request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it.each([
    ['POST', '/auth/change-password'],
    ['DELETE', '/auth/account'],
    ['POST', '/premium/checkout'],
    ['POST', '/premium/checkout/confirm'],
    ['POST', '/premium/restore'],
    ['POST', '/premium/manage'],
    ['POST', '/usage/consume'],
    ['GET', '/usage/status'],
  ])('requires authentication for %s %s', async (method, path) => {
    const response = await app().request(path, { method });
    expect(response.status).toBe(401);
  });

  it('rejects unsigned Stripe webhooks before parsing their payload', async () => {
    const response = await app().request('/auth/stripe/webhook', {
      method: 'POST',
      body: 'not-json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid Stripe webhook signature.' });
  });
});

describe('auth store normalization', () => {
  it('fills missing collections and does not share empty database arrays', () => {
    expect(normalizeDb({ users: [{ id: 'user-1' }] })).toMatchObject({
      users: [{ id: 'user-1' }],
      sessions: [],
      usage: [],
    });
    const first = emptyDb();
    const second = emptyDb();
    first.codes.push({
      id: 'code-1',
      email: 'reader@example.com',
      purpose: 'verify_email',
      codeHash: 'hash',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T00:10:00.000Z',
    });
    expect(second.codes).toEqual([]);
  });

  it('removes revoked and stale security records while retaining valid ones', () => {
    const db = emptyDb();
    db.codes.push(
      {
        id: 'expired',
        email: 'reader@example.com',
        purpose: 'verify_email',
        codeHash: 'expired',
        createdAt: '2020-01-01T00:00:00.000Z',
        expiresAt: '2020-01-01T00:10:00.000Z',
        usedAt: '2020-01-01T00:01:00.000Z',
      },
      {
        id: 'valid',
        email: 'reader@example.com',
        purpose: 'verify_email',
        codeHash: 'valid',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    );
    db.sessions.push({
      id: 'revoked',
      userId: 'user-1',
      tokenHash: 'hash',
      createdAt: '2020-01-01T00:00:00.000Z',
      expiresAt: '2020-01-01T01:00:00.000Z',
      revokedAt: '2020-01-01T00:30:00.000Z',
    });

    prune(db);

    expect(db.codes.map((code) => code.id)).toEqual(['valid']);
    expect(db.sessions).toEqual([]);
  });
});
