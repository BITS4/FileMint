import { randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { deliverAuthCode } from './auth.email';
import {
  addMs,
  authenticate,
  authResponse,
  codeHash,
  hashPassword,
  isEmail,
  isStrongPassword,
  issueCode,
  normalizeEmail,
  normalizeUsername,
  nowIso,
  publicUser,
  rateLimited,
  readJson,
  tokenHash,
  validateUsername,
  verifyPassword,
} from './auth.helpers';
import {
  LIMITS,
  LOGIN_LOCK_MS,
  PREMIUM_PLANS,
  SESSION_MS,
  SESSION_WARNING_MS,
  type UserRecord,
} from './auth.models';
import { emailSchema, loginSchema, schemaError, signupSchema, verificationSchema } from './auth.schemas';
import { loadDb, mutateDb, writeDb } from './auth.store';

export function registerAccountRoutes(app: Hono): void {
  app.get('/auth/plans', (c) => c.json({ plans: PREMIUM_PLANS }));
  app.get('/premium/plans', (c) => c.json({ plans: PREMIUM_PLANS }));

  app.get('/auth/username', async (c) => {
    const username = normalizeUsername(c.req.query('username'));
    const validationError = validateUsername(username);
    if (validationError)
      return c.json({ username, valid: false, available: false, message: validationError });
    const db = await loadDb();
    const available = !db.users.some(
      (user) => normalizeUsername(user.username) === username && !user.deletedAt,
    );
    return c.json({
      username,
      valid: true,
      available,
      message: available ? 'Username is available.' : 'This username is already taken.',
    });
  });

  app.post('/auth/signup', async (c) => {
    const body = await readJson(c);
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: schemaError(parsed.error) }, 400);
    const { email, username, password, fullName, phone } = parsed.data;

    const limited = rateLimited(c, 'signup', email);
    if (limited) return c.json({ error: limited }, 429);

    const result = await mutateDb(async (db) => {
      if (db.users.some((user) => user.email === email && !user.deletedAt)) {
        return { error: 'An account with this email already exists.' };
      }
      if (db.users.some((user) => normalizeUsername(user.username) === username && !user.deletedAt)) {
        return { error: 'This username is already taken.' };
      }
      const user: UserRecord = {
        id: randomUUID(),
        email,
        username,
        password: await hashPassword(password),
        fullName,
        phone,
        emailVerified: false,
        createdAt: nowIso(),
        premiumStatus: 'free',
        premiumStartsAt: null,
        premiumExpiresAt: null,
        lifetimePremium: false,
        currentPlanId: null,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      db.users.push(user);
      const code = issueCode(db, email, 'verify_email', user.id);
      return { user: publicUser(user), code };
    });

    if ('error' in result) return c.json({ error: result.error }, 409);
    const delivery = await deliverAuthCode(c, {
      email,
      code: result.code,
      purpose: 'verify_email',
      fullName,
    });
    if (delivery.error) return c.json({ error: delivery.error, user: result.user }, 502);
    return c.json({ user: result.user, sent: delivery.sent, devCode: delivery.devCode }, 201);
  });

  app.post('/auth/verify-email', async (c) => {
    const body = await readJson(c);
    const parsed = verificationSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: schemaError(parsed.error) }, 400);
    const { email, code } = parsed.data;

    const result = await mutateDb((db) => {
      const user = db.users.find((item) => item.email === email && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 };
      if (user.emailVerified) return { error: 'This email is already verified.', status: 409 };
      const record = db.codes.find(
        (item) =>
          item.email === email &&
          item.purpose === 'verify_email' &&
          !item.usedAt &&
          item.codeHash === codeHash(email, 'verify_email', code),
      );
      if (!record) return { error: 'The confirmation code is wrong or has already been used.', status: 400 };
      if (new Date(record.expiresAt).getTime() <= Date.now())
        return { error: 'The confirmation code has expired. Request a new code.', status: 410 };
      record.usedAt = nowIso();
      user.emailVerified = true;
      return { user: publicUser(user) };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 410);
    return c.json({ user: result.user });
  });

  app.post('/auth/resend-code', async (c) => {
    const body = await readJson(c);
    const parsed = emailSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: schemaError(parsed.error) }, 400);
    const { email } = parsed.data;
    const limited = rateLimited(c, 'code', email);
    if (limited) return c.json({ error: limited }, 429);

    const result = await mutateDb((db) => {
      const user = db.users.find((item) => item.email === email && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 };
      if (user.emailVerified) return { error: 'This email is already verified.', status: 409 };
      const recent = db.codes.filter(
        (item) =>
          item.email === email &&
          item.purpose === 'verify_email' &&
          new Date(item.createdAt).getTime() > Date.now() - LIMITS.code.windowMs,
      );
      if (recent.length >= LIMITS.code.count)
        return { error: 'Too many confirmation emails. Try again later.', status: 429 };
      const code = issueCode(db, email, 'verify_email', user.id);
      return { code, fullName: user.fullName ?? null };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status as 404 | 409 | 429);
    const delivery = await deliverAuthCode(c, {
      email,
      code: result.code,
      purpose: 'verify_email',
      fullName: result.fullName,
    });
    if (delivery.error) return c.json({ error: delivery.error }, 502);
    return c.json({ sent: delivery.sent, devCode: delivery.devCode });
  });

  app.post('/auth/login', async (c) => {
    const body = await readJson(c);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: schemaError(parsed.error) }, 400);
    const { email, password } = parsed.data;
    const limited = rateLimited(c, 'login', email);
    if (limited) return c.json({ error: limited }, 429);

    const result = await mutateDb(async (db) => {
      const user = db.users.find((item) => item.email === email && !item.deletedAt);
      const generic = { error: 'Email or password is incorrect.', status: 401 as const };
      if (!user) return generic;
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        return {
          error: 'This account is temporarily locked after too many failed attempts. Try again later.',
          status: 423 as const,
        };
      }
      const ok = await verifyPassword(password, user.password);
      if (!ok) {
        user.failedLoginAttempts += 1;
        if (user.failedLoginAttempts >= 5) user.lockedUntil = addMs(LOGIN_LOCK_MS);
        return generic;
      }
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      if (!user.emailVerified) {
        const code = issueCode(db, email, 'verify_email', user.id);
        return {
          error: 'Verify your email before logging in.',
          status: 403 as const,
          code,
          fullName: user.fullName ?? null,
        };
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = addMs(SESSION_MS);
      user.lastLoginAt = nowIso();
      db.sessions.push({
        id: randomUUID(),
        userId: user.id,
        tokenHash: tokenHash(token),
        createdAt: nowIso(),
        expiresAt,
        revokedAt: null,
      });
      return authResponse(user, token, expiresAt);
    });

    if ('error' in result) {
      const delivery =
        'code' in result && typeof result.code === 'string'
          ? await deliverAuthCode(c, {
              email,
              code: result.code,
              purpose: 'verify_email',
              fullName: result.fullName ?? null,
            })
          : null;
      if (delivery?.error) return c.json({ error: delivery.error, emailVerificationRequired: true }, 502);
      return c.json(
        {
          error: result.error,
          emailVerificationRequired: result.status === 403,
          ...(delivery?.devCode ? { devCode: delivery.devCode } : {}),
        },
        result.status,
      );
    }
    return c.json(result);
  });

  app.post('/auth/logout', async (c) => {
    const header = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return c.json({ ok: true });
    await mutateDb((db) => {
      const session = db.sessions.find((item) => item.tokenHash === tokenHash(match[1]) && !item.revokedAt);
      if (session) session.revokedAt = nowIso();
    });
    return c.json({ ok: true });
  });

  app.get('/auth/me', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Session expired. Please log in again.' }, 401);
    await writeDb(auth.db);
    return c.json({
      user: publicUser(auth.user),
      session: {
        expiresAt: auth.session.expiresAt,
        warningAt: new Date(new Date(auth.session.expiresAt).getTime() - SESSION_WARNING_MS).toISOString(),
      },
    });
  });

  app.post('/auth/password-reset/request', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const limited = rateLimited(c, 'passwordReset', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
    const result = await mutateDb((db) => {
      const user = db.users.find((item) => item.email === email && !item.deletedAt);
      if (!user) return { sent: true };
      const code = issueCode(db, email, 'password_reset', user.id);
      return { sent: true, code, fullName: user.fullName ?? null };
    });
    if ('code' in result && typeof result.code === 'string') {
      const delivery = await deliverAuthCode(c, {
        email,
        code: result.code,
        purpose: 'password_reset',
        fullName: result.fullName ?? null,
      });
      if (delivery.error) return c.json({ error: delivery.error }, 502);
      return c.json({ sent: delivery.sent, devCode: delivery.devCode });
    }
    return c.json({ sent: true });
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? '').trim();
    const password = String(body.password ?? '');
    if (!isEmail(email) || !/^\d{6}$/.test(code)) return c.json({ error: 'Enter the reset code.' }, 400);
    if (!isStrongPassword(password))
      return c.json(
        { error: 'Password must be at least 8 characters and include a letter and a number.' },
        400,
      );

    const result = await mutateDb(async (db) => {
      const user = db.users.find((item) => item.email === email && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const record = db.codes.find(
        (item) =>
          item.email === email &&
          item.purpose === 'password_reset' &&
          !item.usedAt &&
          item.codeHash === codeHash(email, 'password_reset', code),
      );
      if (!record)
        return { error: 'The reset code is wrong or has already been used.', status: 400 as const };
      if (new Date(record.expiresAt).getTime() <= Date.now())
        return { error: 'The reset code has expired. Request a new code.', status: 410 as const };
      record.usedAt = nowIso();
      user.password = await hashPassword(password);
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      for (const session of db.sessions.filter((item) => item.userId === user.id && !item.revokedAt))
        session.revokedAt = nowIso();
      return { ok: true };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.post('/auth/change-password', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Session expired. Please log in again.' }, 401);
    const body = await readJson(c);
    const currentPassword = String(body.currentPassword ?? '');
    const newPassword = String(body.newPassword ?? '');
    if (!isStrongPassword(newPassword))
      return c.json(
        { error: 'New password must be at least 8 characters and include a letter and a number.' },
        400,
      );

    const result = await mutateDb(async (db) => {
      const user = db.users.find((item) => item.id === auth.user.id && !item.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      if (!(await verifyPassword(currentPassword, user.password)))
        return { error: 'Current password is incorrect.', status: 401 as const };
      user.password = await hashPassword(newPassword);
      for (const session of db.sessions.filter(
        (item) => item.userId === user.id && item.tokenHash !== auth.session.tokenHash && !item.revokedAt,
      ))
        session.revokedAt = nowIso();
      return { user: publicUser(user) };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ user: result.user });
  });

  app.delete('/auth/account', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Session expired. Please log in again.' }, 401);
    await mutateDb((db) => {
      const user = db.users.find((item) => item.id === auth.user.id);
      if (user) user.deletedAt = nowIso();
      for (const session of db.sessions.filter((item) => item.userId === auth.user.id && !item.revokedAt))
        session.revokedAt = nowIso();
    });
    return c.json({ ok: true });
  });
}
