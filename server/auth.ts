import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Context, Hono } from 'hono';

const scrypt = promisify(scryptCb);

const DATA_DIR = fileURLToPath(new URL('./data', import.meta.url));
const DB_PATH = join(DATA_DIR, 'auth-db.json');
const SESSION_MS = 60 * 60 * 1000;
const SESSION_WARNING_MS = 5 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type PlanId = 'week' | 'month' | 'year' | 'forever';
type CodePurpose = 'verify_email' | 'password_reset';
type PremiumStatus = 'free' | 'active' | 'expired' | 'canceled' | 'refunded';

interface PasswordRecord {
  salt: string;
  hash: string;
}

interface UserRecord {
  id: string;
  email: string;
  password: PasswordRecord;
  fullName?: string | null;
  phone?: string | null;
  emailVerified: boolean;
  createdAt: string;
  currentPlanId?: PlanId | null;
  premiumStatus: PremiumStatus;
  premiumStartsAt?: string | null;
  premiumExpiresAt?: string | null;
  lifetimePremium: boolean;
  lastLoginAt?: string | null;
  failedLoginAttempts: number;
  lockedUntil?: string | null;
  deletedAt?: string | null;
}

interface CodeRecord {
  id: string;
  email: string;
  userId?: string | null;
  purpose: CodePurpose;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
}

interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

interface PurchaseRecord {
  id: string;
  userId: string;
  planId: PlanId;
  provider: 'stripe-dev' | 'stripe' | 'apple' | 'google';
  providerRef: string;
  amountCents: number;
  currency: 'usd';
  status: 'paid' | 'failed' | 'canceled' | 'refunded' | 'expired';
  startedAt: string;
  expiresAt?: string | null;
  createdAt: string;
}

interface PaymentEventRecord {
  id: string;
  userId?: string | null;
  purchaseId?: string | null;
  provider: string;
  type: string;
  status: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

interface UsageRecord {
  userId: string;
  date: string;
  conversions: number;
  ocrTasks: number;
  compressions: number;
  scans: number;
  batchJobs: number;
}

interface AuthDb {
  users: UserRecord[];
  codes: CodeRecord[];
  sessions: SessionRecord[];
  purchases: PurchaseRecord[];
  paymentEvents: PaymentEventRecord[];
  usage: UsageRecord[];
}

interface PublicUser {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  emailVerified: boolean;
  createdAt: string;
  currentPlanId?: PlanId | null;
  premiumStatus: PremiumStatus;
  premiumStartsAt?: string | null;
  premiumExpiresAt?: string | null;
  lifetimePremium: boolean;
  lastLoginAt?: string | null;
}

export const PREMIUM_PLANS = [
  {
    id: 'week',
    name: '1 Week Plan',
    shortName: '1 Week',
    price: '$0.99',
    amountCents: 99,
    durationLabel: '7 days',
  },
  {
    id: 'month',
    name: '1 Month Plan',
    shortName: '1 Month',
    price: '$4.99',
    amountCents: 499,
    durationLabel: '1 month',
  },
  {
    id: 'year',
    name: '1 Year Plan',
    shortName: '1 Year',
    price: '$49.99',
    amountCents: 4999,
    durationLabel: '1 year',
    bestValue: true,
  },
  {
    id: 'forever',
    name: 'Forever Plan',
    shortName: 'Forever',
    price: '$199.99',
    amountCents: 19999,
    durationLabel: 'lifetime access',
  },
] as const;

const EMPTY_DB: AuthDb = {
  users: [],
  codes: [],
  sessions: [],
  purchases: [],
  paymentEvents: [],
  usage: [],
};

const LIMITS = {
  signup: { count: 5, windowMs: 15 * 60 * 1000 },
  login: { count: 10, windowMs: 15 * 60 * 1000 },
  code: { count: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { count: 5, windowMs: 60 * 60 * 1000 },
  checkout: { count: 12, windowMs: 10 * 60 * 1000 },
};

const FREE_USAGE_LIMITS: Record<keyof Omit<UsageRecord, 'userId' | 'date'>, number> = {
  conversions: 10,
  ocrTasks: 2,
  compressions: 5,
  scans: 10,
  batchJobs: 0,
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let saveChain = Promise.resolve();

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStrongPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function addMs(ms: number, start = new Date()): string {
  return new Date(start.getTime() + ms).toISOString();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function tokenHash(token: string): string {
  return hash(`session:${token}`);
}

function codeHash(email: string, purpose: CodePurpose, code: string): string {
  return hash(`code:${purpose}:${email}:${code}`);
}

function publicUser(user: UserRecord): PublicUser {
  syncPremium(user);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName ?? null,
    phone: user.phone ?? null,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    currentPlanId: user.currentPlanId ?? null,
    premiumStatus: user.premiumStatus,
    premiumStartsAt: user.premiumStartsAt ?? null,
    premiumExpiresAt: user.premiumExpiresAt ?? null,
    lifetimePremium: user.lifetimePremium,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

async function loadDb(): Promise<AuthDb> {
  try {
    const raw = await readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AuthDb>;
    return {
      users: parsed.users ?? [],
      codes: parsed.codes ?? [],
      sessions: parsed.sessions ?? [],
      purchases: parsed.purchases ?? [],
      paymentEvents: parsed.paymentEvents ?? [],
      usage: parsed.usage ?? [],
    };
  } catch {
    await mkdir(dirname(DB_PATH), { recursive: true });
    await writeDb(EMPTY_DB);
    return { ...EMPTY_DB };
  }
}

async function writeDb(db: AuthDb): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  await rename(tmp, DB_PATH);
}

async function mutateDb<T>(fn: (db: AuthDb) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const db = await loadDb();
    prune(db);
    const result = await fn(db);
    await writeDb(db);
    return result;
  };
  const next = saveChain.then(run, run);
  saveChain = next.then(() => undefined, () => undefined);
  return next;
}

function prune(db: AuthDb): void {
  const cutoff = Date.now() - 7 * DAY_MS;
  db.codes = db.codes.filter((code) => !code.usedAt && new Date(code.expiresAt).getTime() > cutoff);
  db.sessions = db.sessions.filter((session) => !session.revokedAt && new Date(session.expiresAt).getTime() > cutoff);
}

async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: key.toString('hex') };
}

async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const key = (await scrypt(password, record.salt, 64)) as Buffer;
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(expected, key);
}

function createCode(): string {
  return String(randomInt(100000, 1000000));
}

function issueCode(db: AuthDb, email: string, purpose: CodePurpose, userId?: string | null): string {
  const code = createCode();
  db.codes.push({
    id: randomUUID(),
    email,
    userId: userId ?? null,
    purpose,
    codeHash: codeHash(email, purpose, code),
    createdAt: nowIso(),
    expiresAt: addMs(CODE_MS),
    usedAt: null,
  });
  return code;
}

function isActivePremium(user: UserRecord): boolean {
  syncPremium(user);
  return user.lifetimePremium || user.premiumStatus === 'active';
}

function syncPremium(user: UserRecord): void {
  if (user.lifetimePremium) {
    user.premiumStatus = 'active';
    user.premiumExpiresAt = null;
    return;
  }
  if (user.premiumStatus === 'active' && user.premiumExpiresAt && new Date(user.premiumExpiresAt).getTime() <= Date.now()) {
    user.premiumStatus = 'expired';
  }
}

function expiryFor(planId: PlanId, start: Date): string | null {
  if (planId === 'forever') return null;
  const end = new Date(start);
  if (planId === 'week') end.setDate(end.getDate() + 7);
  if (planId === 'month') end.setMonth(end.getMonth() + 1);
  if (planId === 'year') end.setFullYear(end.getFullYear() + 1);
  return end.toISOString();
}

function requestKey(c: Context, action: string, email?: string): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local';
  return `${action}:${ip}:${email ?? ''}`;
}

function rateLimited(c: Context, action: keyof typeof LIMITS, email?: string): string | null {
  const limit = LIMITS[action];
  const key = requestKey(c, action, email);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > limit.count) {
    const seconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return `Too many attempts. Try again in ${seconds} seconds.`;
  }
  return null;
}

async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function authenticate(c: Context): Promise<{ db: AuthDb; user: UserRecord; session: SessionRecord } | null> {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const hashed = tokenHash(match[1]);
  const db = await loadDb();
  prune(db);
  const session = db.sessions.find((s) => s.tokenHash === hashed && !s.revokedAt);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = db.users.find((u) => u.id === session.userId && !u.deletedAt);
  if (!user) return null;
  syncPremium(user);
  return { db, user, session };
}

function authResponse(user: UserRecord, token: string, expiresAt: string) {
  return {
    user: publicUser(user),
    session: {
      token,
      expiresAt,
      warningAt: new Date(new Date(expiresAt).getTime() - SESSION_WARNING_MS).toISOString(),
      maxAgeSeconds: Math.floor(SESSION_MS / 1000),
    },
  };
}

function devCodePayload(code: string) {
  return {
    // Local/dev delivery: a production SMTP provider can send this same code.
    devCode: process.env.NODE_ENV === 'production' ? undefined : code,
  };
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getUsage(db: AuthDb, userId: string): UsageRecord {
  const date = todayKey();
  let usage = db.usage.find((item) => item.userId === userId && item.date === date);
  if (!usage) {
    usage = { userId, date, conversions: 0, ocrTasks: 0, compressions: 0, scans: 0, batchJobs: 0 };
    db.usage.push(usage);
  }
  return usage;
}

export function registerAuth(app: Hono): void {
  app.get('/auth/plans', (c) => c.json({ plans: PREMIUM_PLANS }));
  app.get('/premium/plans', (c) => c.json({ plans: PREMIUM_PLANS }));

  app.post('/auth/signup', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    const fullName = String(body.fullName ?? '').trim() || null;
    const phone = String(body.phone ?? '').trim() || null;

    const limited = rateLimited(c, 'signup', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
    if (!isStrongPassword(password)) return c.json({ error: 'Password must be at least 8 characters and include a letter and a number.' }, 400);

    const result = await mutateDb(async (db) => {
      if (db.users.some((u) => u.email === email && !u.deletedAt)) {
        return { error: 'An account with this email already exists.' };
      }
      const user: UserRecord = {
        id: randomUUID(),
        email,
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
      console.info(`[FileMint auth] Verification code for ${email}: ${code}`);
      return { user: publicUser(user), code };
    });

    if ('error' in result) return c.json({ error: result.error }, 409);
    return c.json({ user: result.user, ...devCodePayload(result.code) }, 201);
  });

  app.post('/auth/verify-email', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? '').trim();
    if (!isEmail(email) || !/^\d{6}$/.test(code)) return c.json({ error: 'Enter the 6-digit confirmation code.' }, 400);

    const result = await mutateDb((db) => {
      const user = db.users.find((u) => u.email === email && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 };
      if (user.emailVerified) return { error: 'This email is already verified.', status: 409 };
      const record = db.codes.find((item) => item.email === email && item.purpose === 'verify_email' && !item.usedAt && item.codeHash === codeHash(email, 'verify_email', code));
      if (!record) return { error: 'The confirmation code is wrong or has already been used.', status: 400 };
      if (new Date(record.expiresAt).getTime() <= Date.now()) return { error: 'The confirmation code has expired. Request a new code.', status: 410 };
      record.usedAt = nowIso();
      user.emailVerified = true;
      return { user: publicUser(user) };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status as 400 | 404 | 409 | 410);
    return c.json({ user: result.user });
  });

  app.post('/auth/resend-code', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const limited = rateLimited(c, 'code', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);

    const result = await mutateDb((db) => {
      const user = db.users.find((u) => u.email === email && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 };
      if (user.emailVerified) return { error: 'This email is already verified.', status: 409 };
      const recent = db.codes.filter(
        (item) => item.email === email && item.purpose === 'verify_email' && new Date(item.createdAt).getTime() > Date.now() - LIMITS.code.windowMs,
      );
      if (recent.length >= LIMITS.code.count) return { error: 'Too many confirmation emails. Try again later.', status: 429 };
      const code = issueCode(db, email, 'verify_email', user.id);
      console.info(`[FileMint auth] Verification code for ${email}: ${code}`);
      return { code };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status as 404 | 409 | 429);
    return c.json({ sent: true, ...devCodePayload(result.code) });
  });

  app.post('/auth/login', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? '');
    const limited = rateLimited(c, 'login', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email) || !password) return c.json({ error: 'Enter your email and password.' }, 400);

    const result = await mutateDb(async (db) => {
      const user = db.users.find((u) => u.email === email && !u.deletedAt);
      const generic = { error: 'Email or password is incorrect.', status: 401 as const };
      if (!user) return generic;
      if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
        return { error: 'This account is temporarily locked after too many failed attempts. Try again later.', status: 423 as const };
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
        console.info(`[FileMint auth] Verification code for ${email}: ${code}`);
        return { error: 'Verify your email before logging in.', status: 403 as const, code };
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
      return c.json(
        {
          error: result.error,
          emailVerificationRequired: result.status === 403,
          ...('code' in result && typeof result.code === 'string' ? devCodePayload(result.code) : {}),
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
      const session = db.sessions.find((s) => s.tokenHash === tokenHash(match[1]) && !s.revokedAt);
      if (session) session.revokedAt = nowIso();
    });
    return c.json({ ok: true });
  });

  app.get('/auth/me', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Session expired. Please log in again.' }, 401);
    await writeDb(auth.db);
    return c.json({ user: publicUser(auth.user), session: { expiresAt: auth.session.expiresAt, warningAt: new Date(new Date(auth.session.expiresAt).getTime() - SESSION_WARNING_MS).toISOString() } });
  });

  app.post('/auth/password-reset/request', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const limited = rateLimited(c, 'passwordReset', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
    const result = await mutateDb((db) => {
      const user = db.users.find((u) => u.email === email && !u.deletedAt);
      if (!user) return { sent: true };
      const code = issueCode(db, email, 'password_reset', user.id);
      console.info(`[FileMint auth] Password reset code for ${email}: ${code}`);
      return { sent: true, code };
    });
    return c.json({ sent: true, ...('code' in result && typeof result.code === 'string' ? devCodePayload(result.code) : {}) });
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? '').trim();
    const password = String(body.password ?? '');
    if (!isEmail(email) || !/^\d{6}$/.test(code)) return c.json({ error: 'Enter the reset code.' }, 400);
    if (!isStrongPassword(password)) return c.json({ error: 'Password must be at least 8 characters and include a letter and a number.' }, 400);

    const result = await mutateDb(async (db) => {
      const user = db.users.find((u) => u.email === email && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const record = db.codes.find((item) => item.email === email && item.purpose === 'password_reset' && !item.usedAt && item.codeHash === codeHash(email, 'password_reset', code));
      if (!record) return { error: 'The reset code is wrong or has already been used.', status: 400 as const };
      if (new Date(record.expiresAt).getTime() <= Date.now()) return { error: 'The reset code has expired. Request a new code.', status: 410 as const };
      record.usedAt = nowIso();
      user.password = await hashPassword(password);
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      for (const session of db.sessions.filter((s) => s.userId === user.id && !s.revokedAt)) session.revokedAt = nowIso();
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
    if (!isStrongPassword(newPassword)) return c.json({ error: 'New password must be at least 8 characters and include a letter and a number.' }, 400);

    const result = await mutateDb(async (db) => {
      const user = db.users.find((u) => u.id === auth.user.id && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      if (!(await verifyPassword(currentPassword, user.password))) return { error: 'Current password is incorrect.', status: 401 as const };
      user.password = await hashPassword(newPassword);
      for (const session of db.sessions.filter((s) => s.userId === user.id && s.tokenHash !== auth.session.tokenHash && !s.revokedAt)) session.revokedAt = nowIso();
      return { user: publicUser(user) };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ user: result.user });
  });

  app.delete('/auth/account', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Session expired. Please log in again.' }, 401);
    await mutateDb((db) => {
      const user = db.users.find((u) => u.id === auth.user.id);
      if (user) user.deletedAt = nowIso();
      for (const session of db.sessions.filter((s) => s.userId === auth.user.id && !s.revokedAt)) session.revokedAt = nowIso();
    });
    return c.json({ ok: true });
  });

  app.post('/premium/checkout', async (c) => {
    const auth = await authenticate(c);
    if (!auth) return c.json({ error: 'Log in before buying premium.' }, 401);
    if (!auth.user.emailVerified) return c.json({ error: 'Verify your email before buying premium.' }, 403);
    const body = await readJson(c);
    const planId = String(body.planId ?? '') as PlanId;
    const provider = String(body.provider ?? 'stripe-dev');
    const plan = PREMIUM_PLANS.find((p) => p.id === planId);
    const limited = rateLimited(c, 'checkout', auth.user.email);
    if (limited) return c.json({ error: limited }, 429);
    if (!plan) return c.json({ error: 'Choose a valid premium plan.' }, 400);
    if (!['stripe-dev', 'stripe', 'apple', 'google'].includes(provider)) return c.json({ error: 'Unsupported payment provider.' }, 400);

    const result = await mutateDb((db) => {
      const user = db.users.find((u) => u.id === auth.user.id && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };

      if (provider !== 'stripe-dev' && !body.receipt && !body.paymentIntentId) {
        db.paymentEvents.push({
          id: randomUUID(),
          userId: user.id,
          provider,
          type: 'verification_missing',
          status: 'failed',
          createdAt: nowIso(),
          payload: { planId },
        });
        return { error: 'Payment verification is not configured yet for this provider.', status: 402 as const };
      }

      const startedAt = nowIso();
      const expiresAt = expiryFor(planId, new Date(startedAt));
      const purchase: PurchaseRecord = {
        id: randomUUID(),
        userId: user.id,
        planId,
        provider: provider as PurchaseRecord['provider'],
        providerRef: String(body.paymentIntentId ?? body.receipt ?? `dev_${randomUUID()}`),
        amountCents: plan.amountCents,
        currency: 'usd',
        status: 'paid',
        startedAt,
        expiresAt,
        createdAt: nowIso(),
      };
      db.purchases.push(purchase);
      db.paymentEvents.push({
        id: randomUUID(),
        userId: user.id,
        purchaseId: purchase.id,
        provider,
        type: 'checkout.verified',
        status: 'paid',
        createdAt: nowIso(),
        payload: { planId, amountCents: plan.amountCents },
      });
      user.currentPlanId = planId;
      user.premiumStartsAt = startedAt;
      user.premiumExpiresAt = expiresAt;
      user.lifetimePremium = planId === 'forever';
      user.premiumStatus = 'active';
      return { user: publicUser(user), purchase };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status);
    return c.json({ user: result.user, purchase: result.purchase, verified: true });
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
      const user = db.users.find((u) => u.id === auth.user.id && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const usage = getUsage(db, user.id);
      if (!isActivePremium(user) && usage[key] >= FREE_USAGE_LIMITS[key]) {
        return { error: 'Daily free limit reached. Upgrade to Premium to continue.', status: 402 as const, usage, limit: FREE_USAGE_LIMITS[key] };
      }
      usage[key] += 1;
      return { usage, premium: isActivePremium(user) };
    });
    if ('error' in result) return c.json({ error: result.error, usage: result.usage, limit: result.limit }, result.status);
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
