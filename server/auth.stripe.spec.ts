import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserRecord } from './auth.models';
import { PREMIUM_PLANS } from './auth.models';
import { emptyDb } from './auth.store';
import {
  activatePaidPlan,
  allowDevPayments,
  createStripeCheckout,
  stripePriceId,
  stripeRequest,
  verifyStripeWebhook,
} from './auth.stripe';

function user(): UserRecord {
  return {
    id: 'user-1',
    email: 'buyer@example.com',
    password: { salt: '00', hash: '00' },
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    premiumStatus: 'free',
    lifetimePremium: false,
    failedLoginAttempts: 0,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Stripe configuration', () => {
  it('maps plan IDs and only allows simulated payments outside production', () => {
    vi.stubEnv('STRIPE_PRICE_MONTH', ' price_month ');
    vi.stubEnv('FILEMINT_ALLOW_DEV_PAYMENTS', 'true');
    vi.stubEnv('NODE_ENV', 'test');

    expect(stripePriceId('month')).toBe('price_month');
    expect(stripePriceId('week')).toBeNull();
    expect(allowDevPayments()).toBe(true);

    vi.stubEnv('NODE_ENV', 'production');
    expect(allowDevPayments()).toBe(false);
  });

  it('accepts a valid Stripe signature and rejects malformed signatures', () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    const body = JSON.stringify({ id: 'evt_1' });
    const timestamp = '1735689600';
    const signature = createHmac('sha256', 'whsec_test').update(`${timestamp}.${body}`).digest('hex');

    expect(verifyStripeWebhook(body, `t=${timestamp},v1=${signature}`)).toBe(true);
    expect(verifyStripeWebhook(body, `t=${timestamp},v1=wrong`)).toBe(false);
    expect(verifyStripeWebhook(body, undefined)).toBe(false);
  });
});

describe('Stripe purchases', () => {
  it('activates a subscription idempotently for the same provider reference', () => {
    const db = emptyDb();
    const account = user();

    const first = activatePaidPlan(db, account, 'month', 'cs_test_1', 'stripe');
    const second = activatePaidPlan(db, account, 'month', 'cs_test_1', 'stripe');

    expect(second.id).toBe(first.id);
    expect(db.purchases).toHaveLength(1);
    expect(account).toMatchObject({ currentPlanId: 'month', premiumStatus: 'active' });
    expect(first.expiresAt).not.toBeNull();
  });

  it('activates lifetime access without an expiry', () => {
    const db = emptyDb();
    const account = user();
    const purchase = activatePaidPlan(db, account, 'forever', 'cs_test_forever', 'stripe');

    expect(purchase.expiresAt).toBeNull();
    expect(account.lifetimePremium).toBe(true);
    expect(account.premiumExpiresAt).toBeNull();
  });

  it('surfaces Stripe errors and decodes successful responses', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'cus_1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Card declined' } }), { status: 402 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(stripeRequest<{ id: string }>('/customers/cus_1')).resolves.toEqual({ id: 'cus_1' });
    await expect(stripeRequest('/payment_intents')).rejects.toThrow('Card declined');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('creates a hosted checkout with account and plan metadata', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test');
    vi.stubEnv('STRIPE_PRICE_WEEK', 'price_week');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.test/1' }), {
          status: 200,
        }),
      ),
    );
    const app = new Hono();
    app.get('/', async (c) => c.json(await createStripeCheckout(c, user(), PREMIUM_PLANS[0])));

    const response = await app.request('https://filemint.test/');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ id: 'cs_test_1', url: 'https://checkout.stripe.test/1' });
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(String(init?.body)).toContain('metadata%5BplanId%5D=week');
    expect(String(init?.body)).toContain('customer_email=buyer%40example.com');
  });
});
