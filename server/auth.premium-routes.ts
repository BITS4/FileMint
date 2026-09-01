import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  authenticate,
  getUsage,
  isActivePremium,
  nowIso,
  publicUser,
  rateLimited,
  readJson,
} from './auth.helpers';
import { FREE_USAGE_LIMITS, PREMIUM_PLANS, type PlanId, type UsageRecord } from './auth.models';
import { mutateDb, writeDb } from './auth.store';
import {
  activatePaidPlan,
  allowDevPayments,
  createStripeCheckout,
  stripePriceId,
  stripeRequest,
  verifyStripeWebhook,
} from './auth.stripe';

const stripeSessionSchema = z.object({
  id: z.string().min(1).max(255),
  payment_status: z.string().max(64).optional(),
  status: z.string().max(64).optional(),
  client_reference_id: z.string().max(255).nullable().optional(),
  metadata: z
    .object({ userId: z.string().max(255).optional(), planId: z.string().max(32).optional() })
    .optional(),
});

const stripeEventSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(255),
  data: z.object({ object: stripeSessionSchema }).optional(),
});

export function registerPremiumRoutes(app: Hono): void {
  app.post('/premium/checkout', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in before buying premium.' }, 401);
    if (!auth.user.emailVerified) return c.json({ error: 'Verify your email before buying premium.' }, 403);
    const body = await readJson(c);
    const planId = String(body.planId ?? '') as PlanId;
    const plan = PREMIUM_PLANS.find((item) => item.id === planId);
    const limited = rateLimited(c, 'checkout', auth.user.email);
    if (limited) return c.json({ error: limited }, 429);
    if (!plan) return c.json({ error: 'Choose a valid premium plan.' }, 400);

    const stripeConfigured = !!process.env.STRIPE_SECRET_KEY?.trim() && !!stripePriceId(planId);
    if (stripeConfigured) {
      try {
        const session = await createStripeCheckout(c, auth.user, plan);
        await mutateDb((db) => {
          db.paymentEvents.push({
            id: randomUUID(),
            userId: auth.user.id,
            provider: 'stripe',
            type: 'checkout.created',
            status: 'pending',
            createdAt: nowIso(),
            payload: { planId, sessionId: session.id },
          });
        });
        return c.json({
          user: publicUser(auth.user),
          checkoutUrl: session.url,
          sessionId: session.id,
          verified: false,
        });
      } catch (error) {
        return c.json(
          { error: error instanceof Error ? error.message : 'Could not start Stripe Checkout.' },
          502,
        );
      }
    }

    if (!allowDevPayments()) {
      return c.json(
        {
          error:
            'Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_PRICE_WEEK / MONTH / YEAR / FOREVER before taking real Visa or Mastercard payments.',
        },
        503,
      );
    }

    const result = await mutateDb((db) => {
      const user = db.users.find((item) => item.id === auth.user.id && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const purchase = activatePaidPlan(db, user, planId, `dev_${randomUUID()}`, 'stripe-dev', {
        planId,
        amountCents: plan.amountCents,
      });
      return { user: publicUser(user), purchase };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ user: result.user, purchase: result.purchase, verified: true });
  });

  app.post('/premium/checkout/confirm', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in to confirm payment.' }, 401);
    const body = await readJson(c);
    const sessionId = String(body.sessionId ?? '').trim();
    if (!/^cs_(test|live)_/.test(sessionId))
      return c.json({ error: 'Missing Stripe Checkout session.' }, 400);

    try {
      const rawSession = await stripeRequest<unknown>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
      const parsedSession = stripeSessionSchema.safeParse(rawSession);
      if (!parsedSession.success)
        return c.json({ error: 'Stripe returned an invalid checkout session.' }, 502);
      const session = parsedSession.data;
      const planId = session.metadata?.planId as PlanId | undefined;
      if (session.client_reference_id !== auth.user.id && session.metadata?.userId !== auth.user.id)
        return c.json({ error: 'This checkout session belongs to another account.' }, 403);
      if (!planId || !PREMIUM_PLANS.some((plan) => plan.id === planId))
        return c.json({ error: 'Stripe session is missing the FileMint plan.' }, 400);
      if (session.payment_status !== 'paid')
        return c.json({ error: 'Stripe has not confirmed this payment yet.' }, 402);

      const result = await mutateDb((db) => {
        const user = db.users.find((item) => item.id === auth.user.id && !item.deletedAt);
        if (!user) return { error: 'Account not found.', status: 404 as const };
        const purchase = activatePaidPlan(db, user, planId, session.id, 'stripe', {
          sessionId: session.id,
          status: session.status,
          paymentStatus: session.payment_status,
        });
        return { user: publicUser(user), purchase };
      });

      if ('error' in result) return c.json({ error: result.error }, result.status);
      return c.json({ user: result.user, purchase: result.purchase, verified: true });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'Could not confirm Stripe payment.' },
        502,
      );
    }
  });

  app.post('/auth/stripe/webhook', async (c) => {
    const rawBody = await c.req.text();
    if (!verifyStripeWebhook(rawBody, c.req.header('stripe-signature'))) {
      return c.json({ error: 'Invalid Stripe webhook signature.' }, 400);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid Stripe webhook payload.' }, 400);
    }
    const parsedEvent = stripeEventSchema.safeParse(decoded);
    if (!parsedEvent.success) return c.json({ error: 'Invalid Stripe webhook payload.' }, 400);
    const event = parsedEvent.data;
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      const userId = session?.metadata?.userId || session?.client_reference_id || null;
      const planId = session?.metadata?.planId as PlanId | undefined;
      const sessionId = session?.id;
      if (sessionId && userId && planId && session.payment_status === 'paid') {
        await mutateDb((db) => {
          if (
            db.paymentEvents.some(
              (paymentEvent) =>
                paymentEvent.provider === 'stripe' && paymentEvent.payload?.eventId === event.id,
            )
          )
            return;
          const user = db.users.find((item) => item.id === userId && !item.deletedAt);
          if (!user || !PREMIUM_PLANS.some((plan) => plan.id === planId)) return;
          activatePaidPlan(db, user, planId, sessionId, 'stripe', { eventId: event.id, sessionId });
        });
      }
    }
    return c.json({ received: true });
  });

  app.post('/premium/restore', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in to restore purchases.' }, 401);
    await writeDb(auth.db);
    return c.json({ user: publicUser(auth.user), restored: isActivePremium(auth.user) });
  });

  app.post('/premium/manage', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in to manage your subscription.' }, 401);
    return c.json({
      message: auth.user.currentPlanId
        ? 'Manage or cancel this subscription from the payment provider used to buy it.'
        : 'No active premium purchase found.',
      user: publicUser(auth.user),
    });
  });

  app.post('/usage/consume', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in to use account-tracked limits.' }, 401);
    const body = await readJson(c);
    const key = String(body.kind ?? 'conversions') as keyof Omit<UsageRecord, 'userId' | 'date'>;
    if (!(key in FREE_USAGE_LIMITS)) return c.json({ error: 'Unknown usage type.' }, 400);
    const result = await mutateDb((db) => {
      const user = db.users.find((item) => item.id === auth.user.id && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const usage = getUsage(db, user.id);
      if (!isActivePremium(user) && usage[key] >= FREE_USAGE_LIMITS[key]) {
        return {
          error: 'Daily free limit reached. Upgrade to Premium to continue.',
          status: 402 as const,
          usage,
          limit: FREE_USAGE_LIMITS[key],
        };
      }
      usage[key] += 1;
      return { usage, premium: isActivePremium(user) };
    });
    if ('error' in result)
      return c.json({ error: result.error, usage: result.usage, limit: result.limit }, result.status);
    return c.json(result);
  });

  app.get('/usage/status', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in to view usage.' }, 401);
    const usage = getUsage(auth.db, auth.user.id);
    await writeDb(auth.db);
    return c.json({ usage, limits: FREE_USAGE_LIMITS, premium: isActivePremium(auth.user) });
  });
}
