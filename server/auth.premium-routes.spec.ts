import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticate, rateLimited } from './auth.helpers';
import { emptyDb, mutateDb, writeDb } from './auth.store';
import type { AuthDb, UserRecord } from './auth.models';
import { registerPremiumRoutes } from './auth.premium-routes';
import {
  activatePaidPlan,
  allowDevPayments,
  createStripeCheckout,
  stripePriceId,
  stripeRequest,
  verifyStripeWebhook,
} from './auth.stripe';

const state = vi.hoisted(() => ({ db: null as AuthDb | null }));

vi.mock('./auth.store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.store')>();
  return {
    ...actual,
    mutateDb: vi.fn(async <T>(fn: (db: AuthDb) => T | Promise<T>) => fn(state.db as AuthDb)),
    writeDb: vi.fn(async () => undefined),
  };
});

vi.mock('./auth.helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.helpers')>();
  return { ...actual, authenticate: vi.fn(), rateLimited: vi.fn(() => null) };
});

vi.mock('./auth.stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.stripe')>();
  return {
    ...actual,
    activatePaidPlan: vi.fn(actual.activatePaidPlan),
    allowDevPayments: vi.fn(() => false),
    createStripeCheckout: vi.fn(),
    stripePriceId: vi.fn(),
    stripeRequest: vi.fn(),
    verifyStripeWebhook: vi.fn(() => false),
  };
});

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: 'user-1',
    email: 'premium@example.com',
    username: 'premium_user',
    password: 'hash',
    fullName: 'Premium User',
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
  registerPremiumRoutes(instance);
  return instance;
}

function jsonRequest(path: string, body: unknown = {}) {
  return app().request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function authenticateAs(account: UserRecord = user()) {
  const session = {
    id: 'session-1',
    userId: account.id,
    tokenHash: 'token-hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    revokedAt: null,
  };
  state.db?.users.push(account);
  state.db?.sessions.push(session);
  vi.mocked(authenticate).mockResolvedValue({ db: state.db as AuthDb, user: account, session });
  return account;
}

beforeEach(() => {
  state.db = emptyDb();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(authenticate).mockReset();
  vi.mocked(createStripeCheckout).mockReset();
  vi.mocked(stripeRequest).mockReset();
  vi.mocked(rateLimited).mockReturnValue(null);
  vi.mocked(allowDevPayments).mockReturnValue(false);
  vi.mocked(stripePriceId).mockReturnValue(undefined);
  vi.mocked(verifyStripeWebhook).mockReturnValue(false);
});

describe('premium checkout routes', () => {
  it('enforces authentication, verification, rate limits, and valid plans', async () => {
    expect((await jsonRequest('/premium/checkout', { planId: 'month' })).status).toBe(401);

    authenticateAs(user({ emailVerified: false }));
    expect((await jsonRequest('/premium/checkout', { planId: 'month' })).status).toBe(403);

    vi.mocked(authenticate).mockResolvedValue({
      db: state.db as AuthDb,
      user: state.db?.users[0] as UserRecord,
      session: state.db?.sessions[0]!,
    });
    state.db!.users[0].emailVerified = true;
    vi.mocked(rateLimited).mockReturnValueOnce('Checkout limit reached.');
    expect((await jsonRequest('/premium/checkout', { planId: 'month' })).status).toBe(429);
    expect((await jsonRequest('/premium/checkout', { planId: 'unknown' })).status).toBe(400);
  });

  it('creates Stripe checkout sessions and records pending events', async () => {
    const account = authenticateAs();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
    vi.mocked(stripePriceId).mockReturnValue('price_month');
    vi.mocked(createStripeCheckout).mockResolvedValue({ id: 'cs_test_123', url: 'https://checkout.test' });

    const response = await jsonRequest('/premium/checkout', { planId: 'month' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      checkoutUrl: 'https://checkout.test',
      sessionId: 'cs_test_123',
      verified: false,
    });
    expect(state.db?.paymentEvents[0]).toMatchObject({
      userId: account.id,
      type: 'checkout.created',
      status: 'pending',
    });

    vi.mocked(createStripeCheckout).mockRejectedValueOnce(new Error('Stripe unavailable'));
    const failed = await jsonRequest('/premium/checkout', { planId: 'month' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'Stripe unavailable' });
  });

  it('gates development payments and activates an allowed development purchase', async () => {
    const account = authenticateAs();
    expect((await jsonRequest('/premium/checkout', { planId: 'week' })).status).toBe(503);

    vi.mocked(allowDevPayments).mockReturnValue(true);
    const success = await jsonRequest('/premium/checkout', { planId: 'week' });
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ verified: true });
    expect(account.currentPlanId).toBe('week');

    state.db!.users = [];
    expect((await jsonRequest('/premium/checkout', { planId: 'week' })).status).toBe(404);
  });

  it('validates and confirms paid Stripe sessions', async () => {
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_1' })).status).toBe(401);
    const account = authenticateAs();
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'bad' })).status).toBe(400);

    vi.mocked(stripeRequest).mockResolvedValueOnce({
      id: 'cs_test_other',
      payment_status: 'paid',
      client_reference_id: 'another-user',
      metadata: { planId: 'month' },
    });
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_other' })).status).toBe(403);

    vi.mocked(stripeRequest).mockResolvedValueOnce({
      id: 'cs_test_missing',
      payment_status: 'paid',
      client_reference_id: account.id,
      metadata: { userId: account.id },
    });
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_missing' })).status).toBe(
      400,
    );

    vi.mocked(stripeRequest).mockResolvedValueOnce({
      id: 'cs_test_pending',
      status: 'complete',
      payment_status: 'unpaid',
      client_reference_id: account.id,
      metadata: { userId: account.id, planId: 'month' },
    });
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_pending' })).status).toBe(
      402,
    );

    vi.mocked(stripeRequest).mockResolvedValueOnce({ unexpected: true });
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_invalid' })).status).toBe(
      502,
    );

    vi.mocked(stripeRequest).mockResolvedValueOnce({
      id: 'cs_test_paid',
      status: 'complete',
      payment_status: 'paid',
      metadata: { userId: account.id, planId: 'month' },
    });
    const paid = await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_paid' });
    expect(paid.status).toBe(200);
    expect(account.currentPlanId).toBe('month');

    vi.mocked(stripeRequest).mockRejectedValueOnce(new Error('confirmation failed'));
    expect((await jsonRequest('/premium/checkout/confirm', { sessionId: 'cs_test_error' })).status).toBe(502);
  });
});

describe('premium webhook, management, and usage routes', () => {
  it('rejects unsigned webhooks and safely accepts irrelevant signed events', async () => {
    expect((await jsonRequest('/auth/stripe/webhook', { type: 'test' })).status).toBe(400);
    vi.mocked(verifyStripeWebhook).mockReturnValue(true);
    const response = await jsonRequest('/auth/stripe/webhook', { id: 'evt_1', type: 'customer.created' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  it('activates valid completed webhook sessions and ignores invalid recipients', async () => {
    const account = user();
    state.db?.users.push(account);
    vi.mocked(verifyStripeWebhook).mockReturnValue(true);
    const completed = {
      id: 'evt_paid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_webhook',
          payment_status: 'paid',
          client_reference_id: account.id,
          metadata: { planId: 'year' },
        },
      },
    };
    expect((await jsonRequest('/auth/stripe/webhook', completed)).status).toBe(200);
    expect(account.currentPlanId).toBe('year');

    await jsonRequest('/auth/stripe/webhook', completed);
    expect(activatePaidPlan).toHaveBeenCalledTimes(1);

    const calls = vi.mocked(activatePaidPlan).mock.calls.length;
    await jsonRequest('/auth/stripe/webhook', {
      ...completed,
      data: { object: { ...completed.data.object, client_reference_id: 'missing-user' } },
    });
    await jsonRequest('/auth/stripe/webhook', {
      ...completed,
      data: { object: { ...completed.data.object, metadata: { planId: 'invalid' } } },
    });
    expect(activatePaidPlan).toHaveBeenCalledTimes(calls);
  });

  it('requires a valid paid webhook payload', async () => {
    const account = user();
    state.db?.users.push(account);
    vi.mocked(verifyStripeWebhook).mockReturnValue(true);

    const malformed = await app().request('/auth/stripe/webhook', {
      method: 'POST',
      body: '{not-json',
    });
    expect(malformed.status).toBe(400);

    expect((await jsonRequest('/auth/stripe/webhook', { id: 'evt_missing_type' })).status).toBe(400);
    await jsonRequest('/auth/stripe/webhook', {
      id: 'evt_unpaid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_unpaid',
          status: 'complete',
          payment_status: 'unpaid',
          client_reference_id: account.id,
          metadata: { planId: 'month' },
        },
      },
    });
    expect(account.currentPlanId).toBeNull();
  });

  it('restores and describes free and paid accounts', async () => {
    expect((await jsonRequest('/premium/restore')).status).toBe(401);
    expect((await jsonRequest('/premium/manage')).status).toBe(401);
    const account = authenticateAs();

    const restored = await jsonRequest('/premium/restore');
    expect(await restored.json()).toMatchObject({ restored: false });
    expect(writeDb).toHaveBeenCalledWith(state.db);
    expect(await (await jsonRequest('/premium/manage')).json()).toMatchObject({
      message: 'No active premium purchase found.',
    });

    account.currentPlanId = 'month';
    expect(await (await jsonRequest('/premium/manage')).json()).toMatchObject({
      message: expect.stringContaining('Manage or cancel'),
    });
  });

  it('validates usage keys, limits free accounts, and increments allowed usage', async () => {
    expect((await jsonRequest('/usage/consume', { kind: 'conversions' })).status).toBe(401);
    const account = authenticateAs();
    expect((await jsonRequest('/usage/consume', { kind: 'unknown' })).status).toBe(400);

    state.db!.users = [];
    expect((await jsonRequest('/usage/consume', { kind: 'conversions' })).status).toBe(404);
    state.db!.users = [account];
    state.db!.usage.push({
      userId: account.id,
      date: new Date().toISOString().slice(0, 10),
      conversions: 10,
      ocrTasks: 0,
      compressions: 0,
      scans: 0,
      batchJobs: 0,
    });
    const limited = await jsonRequest('/usage/consume', { kind: 'conversions' });
    expect(limited.status).toBe(402);
    expect(await limited.json()).toMatchObject({ limit: 10 });

    state.db!.usage[0].conversions = 0;
    const consumed = await jsonRequest('/usage/consume', { kind: 'conversions' });
    expect(consumed.status).toBe(200);
    expect(await consumed.json()).toMatchObject({ premium: false, usage: { conversions: 1 } });

    account.lifetimePremium = true;
    state.db!.usage[0].conversions = 10;
    expect((await jsonRequest('/usage/consume', { kind: 'conversions' })).status).toBe(200);
  });

  it('returns persisted usage status for an authenticated account', async () => {
    expect((await app().request('/usage/status')).status).toBe(401);
    authenticateAs(user({ lifetimePremium: true }));
    const response = await app().request('/usage/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ premium: true, usage: { conversions: 0 } });
    expect(mutateDb).not.toHaveBeenCalled();
    expect(writeDb).toHaveBeenCalledWith(state.db);
  });
});
