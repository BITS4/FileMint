import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { appBaseUrl } from './auth.email';
import { expiryFor, nowIso } from './auth.helpers';
import { PREMIUM_PLANS, type AuthDb, type PlanId, type PurchaseRecord, type UserRecord } from './auth.models';

const STRIPE_API = 'https://api.stripe.com/v1';

export function stripePriceId(planId: PlanId): string | null {
  const map: Record<PlanId, string | undefined> = {
    week: process.env.STRIPE_PRICE_WEEK,
    month: process.env.STRIPE_PRICE_MONTH,
    year: process.env.STRIPE_PRICE_YEAR,
    forever: process.env.STRIPE_PRICE_FOREVER,
  };
  return map[planId]?.trim() || null;
}

export function allowDevPayments(): boolean {
  const production = process.env.NODE_ENV === 'production' || process.env.FILEMINT_PRODUCTION === 'true';
  return process.env.FILEMINT_ALLOW_DEV_PAYMENTS === 'true' && !production;
}

function urlForm(entries: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  return form;
}

export async function stripeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY and plan price IDs.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${secret}`);
  const res = await fetch(`${STRIPE_API}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message =
      typeof data === 'object' &&
      data &&
      'error' in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === 'string'
        ? String((data as { error: { message: string } }).error.message)
        : `Stripe request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

export async function createStripeCheckout(
  c: Context,
  user: UserRecord,
  plan: (typeof PREMIUM_PLANS)[number],
): Promise<{ id: string; url: string }> {
  const price = stripePriceId(plan.id);
  if (!price) {
    throw new Error(
      `Stripe price ID is missing for ${plan.shortName}. Set ${`STRIPE_PRICE_${plan.id.toUpperCase()}`}.`,
    );
  }

  const base = appBaseUrl(c);
  const success = `${base}/upgrade?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancel = `${base}/upgrade?checkout=cancel`;
  const mode = plan.id === 'forever' ? 'payment' : 'subscription';
  const form = urlForm({
    mode,
    success_url: success,
    cancel_url: cancel,
    client_reference_id: user.id,
    customer_email: user.email,
    'payment_method_types[0]': 'card',
    'line_items[0][price]': price,
    'line_items[0][quantity]': 1,
    'metadata[userId]': user.id,
    'metadata[planId]': plan.id,
    'metadata[email]': user.email,
    'subscription_data[metadata][userId]': mode === 'subscription' ? user.id : undefined,
    'subscription_data[metadata][planId]': mode === 'subscription' ? plan.id : undefined,
  });

  return stripeRequest<{ id: string; url?: string }>('/checkout/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  }).then((session) => {
    if (!session.url) throw new Error('Stripe did not return a checkout URL.');
    return { id: session.id, url: session.url };
  });
}

export function activatePaidPlan(
  db: AuthDb,
  user: UserRecord,
  planId: PlanId,
  providerRef: string,
  provider: PurchaseRecord['provider'],
  payload?: Record<string, unknown>,
): PurchaseRecord {
  const plan = PREMIUM_PLANS.find((item) => item.id === planId);
  if (!plan) throw new Error('Unknown plan.');
  let purchase = db.purchases.find(
    (item) => item.provider === provider && item.providerRef === providerRef && item.userId === user.id,
  );
  if (!purchase) {
    const startedAt = nowIso();
    purchase = {
      id: randomUUID(),
      userId: user.id,
      planId,
      provider,
      providerRef,
      amountCents: plan.amountCents,
      currency: 'usd',
      status: 'paid',
      startedAt,
      expiresAt: expiryFor(planId, new Date(startedAt)),
      createdAt: nowIso(),
    };
    db.purchases.push(purchase);
  }
  purchase.status = 'paid';
  user.currentPlanId = planId;
  user.premiumStartsAt = purchase.startedAt;
  user.premiumExpiresAt = purchase.expiresAt ?? null;
  user.lifetimePremium = planId === 'forever';
  user.premiumStatus = 'active';
  const eventId = typeof payload?.eventId === 'string' ? payload.eventId : null;
  const alreadyRecorded = db.paymentEvents.some(
    (event) =>
      event.provider === provider &&
      event.type === 'checkout.verified' &&
      event.userId === user.id &&
      (eventId ? event.payload?.eventId === eventId : event.payload?.providerRef === providerRef),
  );
  if (!alreadyRecorded) {
    db.paymentEvents.push({
      id: randomUUID(),
      userId: user.id,
      purchaseId: purchase.id,
      provider,
      type: 'checkout.verified',
      status: 'paid',
      createdAt: nowIso(),
      payload: { planId, providerRef, ...payload },
    });
  }
  return purchase;
}

export function verifyStripeWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const fields = signatureHeader.split(',').map((part) => part.trim().split('=', 2));
  const timestamp = fields.find(([key]) => key === 't')?.[1];
  const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  const signedAt = Number(timestamp);
  if (!Number.isSafeInteger(signedAt) || Math.abs(nowSeconds - signedAt) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return signatures.some((signature) => {
    if (!/^[\da-f]+$/i.test(signature)) return false;
    const signatureBuffer = Buffer.from(signature, 'hex');
    return (
      expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer)
    );
  });
}
