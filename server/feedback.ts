import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';

import { authenticate, nowIso, rateLimited, readJson } from './auth.helpers';
import { mutateDb } from './auth.store';

const feedbackSchema = z.object({
  type: z.enum(['feedback', 'feature']),
  message: z
    .string()
    .trim()
    .min(3, 'Write at least 3 characters.')
    .max(4000, 'Keep the message under 4000 characters.'),
});

export function registerFeedbackRoutes(app: Hono): void {
  app.post('/feedback', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Sign in to send feedback.' }, 401);

    const parsed = feedbackSchema.safeParse(await readJson(c));
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? 'Enter a valid message.' }, 400);
    }

    const limited = rateLimited(c, 'feedback', auth.user.email);
    if (limited) return c.json({ error: limited }, 429);

    const record = await mutateDb((db) => {
      const next = {
        id: randomUUID(),
        userId: auth.user.id,
        type: parsed.data.type,
        message: parsed.data.message,
        status: 'new' as const,
        createdAt: nowIso(),
      };
      db.feedback.push(next);
      if (db.feedback.length > 1000) db.feedback.splice(0, db.feedback.length - 1000);
      return next;
    });

    return c.json({ ok: true, id: record.id }, 201);
  });
}
