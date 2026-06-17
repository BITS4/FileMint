import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
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
const USERNAME_RE = /^[A-Za-z0-9_]{6,}$/;
const STRIPE_API = 'https://api.stripe.com/v1';

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
  username?: string | null;
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
  username?: string | null;
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

function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function validateUsername(username: string): string | null {
  if (!username) return 'Choose a username.';
  if (username.length < 6) return 'Username must be at least 6 characters.';
  if (!USERNAME_RE.test(username)) return 'Use only letters, numbers, and underscore.';
  return null;
}

function normalizePhone(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function isPhone(value: string): boolean {
  return /^\+?[0-9][0-9\s().-]{5,}$/.test(value);
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
    username: user.username ?? null,
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

function isProductionLike(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.FILEMINT_PRODUCTION === 'true';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function appBaseUrl(c: Context): string {
  const configured = process.env.FILEMINT_PUBLIC_URL || process.env.PUBLIC_APP_URL || process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const origin = c.req.header('origin');
  if (origin) return origin.replace(/\/+$/, '');
  const host = c.req.header('host') || `localhost:${process.env.PORT ?? 8787}`;
  const proto = c.req.header('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function buildVerifyUrl(c: Context, email: string, code: string): string {
  const params = new URLSearchParams({ email, code });
  return `${appBaseUrl(c)}/auth/verify?${params.toString()}`;
}

async function deliverAuthCode(c: Context, options: { email: string; code: string; purpose: CodePurpose; fullName?: string | null }): Promise<{ sent: boolean; devCode?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.FILEMINT_EMAIL_FROM || process.env.RESEND_FROM;
  const isVerify = options.purpose === 'verify_email';
  const verifyUrl = isVerify ? buildVerifyUrl(c, options.email, options.code) : null;
  const title = isVerify ? 'Verify your FileMint email' : 'Reset your FileMint password';
  const intro = isVerify ? 'Use this code to verify your FileMint account.' : 'Use this code to reset your FileMint password.';
  const name = options.fullName ? ` ${escapeHtml(options.fullName)}` : '';

  if (apiKey && from) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111827">
        <h1 style="font-size:24px;margin:0 0 16px">FileMint</h1>
        <p>Hello${name},</p>
        <p>${intro}</p>
        <div style="font-size:32px;font-weight:700;letter-spacing:8px;background:#f3f4f6;border-radius:12px;padding:18px 24px;text-align:center">${options.code}</div>
        ${verifyUrl ? `<p style="margin-top:24px"><a href="${escapeHtml(verifyUrl)}" style="background:#10b981;color:#ffffff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p>` : ''}
        <p style="color:#6b7280;font-size:13px">This code expires in 10 minutes. If you did not request this, you can ignore this email.</p>
      </div>`;
    const text = `${title}\n\n${intro}\n\nCode: ${options.code}${verifyUrl ? `\n\nVerify: ${verifyUrl}` : ''}\n\nThis code expires in 10 minutes.`;
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [options.email], subject: title, html, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { sent: false, error: `Email provider rejected the message (${res.status}). ${body.slice(0, 240)}`.trim() };
      }
      return { sent: true };
    } catch (error) {
      return { sent: false, error: error instanceof Error ? error.message : 'Email provider request failed.' };
    }
  }

  if (isProductionLike()) {
    return { sent: false, error: 'Email delivery is not configured. Set RESEND_API_KEY and FILEMINT_EMAIL_FROM before deploying.' };
  }

  console.info(`[FileMint auth] ${isVerify ? 'Verification' : 'Password reset'} code for ${options.email}: ${options.code}`);
  return { sent: false, devCode: options.code };
}

function stripePriceId(planId: PlanId): string | null {
  const map: Record<PlanId, string | undefined> = {
    week: process.env.STRIPE_PRICE_WEEK,
    month: process.env.STRIPE_PRICE_MONTH,
    year: process.env.STRIPE_PRICE_YEAR,
    forever: process.env.STRIPE_PRICE_FOREVER,
  };
  return map[planId]?.trim() || null;
}

function allowDevPayments(): boolean {
  return process.env.FILEMINT_ALLOW_DEV_PAYMENTS === 'true' && !isProductionLike();
}

function urlForm(entries: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  return form;
}

async function stripeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY and plan price IDs.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${secret}`);
  const res = await fetch(`${STRIPE_API}${path}`, { ...init, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data && typeof (data as { error?: { message?: unknown } }).error?.message === 'string'
      ? String((data as { error: { message: string } }).error.message)
      : `Stripe request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

async function createStripeCheckout(c: Context, user: UserRecord, plan: (typeof PREMIUM_PLANS)[number]): Promise<{ id: string; url: string }> {
  const price = stripePriceId(plan.id);
  if (!price) throw new Error(`Stripe price ID is missing for ${plan.shortName}. Set ${`STRIPE_PRICE_${plan.id.toUpperCase()}`}.`);

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

function activatePaidPlan(db: AuthDb, user: UserRecord, planId: PlanId, providerRef: string, provider: PurchaseRecord['provider'], payload?: Record<string, unknown>): PurchaseRecord {
  const plan = PREMIUM_PLANS.find((item) => item.id === planId);
  if (!plan) throw new Error('Unknown plan.');
  let purchase = db.purchases.find((item) => item.provider === provider && item.providerRef === providerRef && item.userId === user.id);
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
  db.paymentEvents.push({
    id: randomUUID(),
    userId: user.id,
    purchaseId: purchase.id,
    provider,
    type: 'checkout.verified',
    status: 'paid',
    createdAt: nowIso(),
    payload: payload ?? { planId },
  });
  return purchase;
}

function verifyStripeWebhook(rawBody: string, signatureHeader: string | undefined): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((part) => {
    const [key, value] = part.split('=');
    return [key, value];
  }));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer);
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

  app.get('/auth/username', async (c) => {
    const username = normalizeUsername(c.req.query('username'));
    const validationError = validateUsername(username);
    if (validationError) return c.json({ username, valid: false, available: false, message: validationError });
    const db = await loadDb();
    const available = !db.users.some((u) => normalizeUsername(u.username) === username && !u.deletedAt);
    return c.json({ username, valid: true, available, message: available ? 'Username is available.' : 'This username is already taken.' });
  });

  app.post('/auth/signup', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    const username = normalizeUsername(body.username);
    const password = String(body.password ?? '');
    const fullName = String(body.fullName ?? '').trim();
    const phone = normalizePhone(body.phone);

    const limited = rateLimited(c, 'signup', email);
    if (limited) return c.json({ error: limited }, 429);
    if (!isEmail(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
    const usernameError = validateUsername(username);
    if (usernameError) return c.json({ error: usernameError }, 400);
    if (fullName.length < 2) return c.json({ error: 'Enter your full name.' }, 400);
    if (!isPhone(phone)) return c.json({ error: 'Enter a valid phone number.' }, 400);
    if (!isStrongPassword(password)) return c.json({ error: 'Password must be at least 8 characters and include a letter and a number.' }, 400);

    const result = await mutateDb(async (db) => {
      if (db.users.some((u) => u.email === email && !u.deletedAt)) {
        return { error: 'An account with this email already exists.' };
      }
      if (db.users.some((u) => normalizeUsername(u.username) === username && !u.deletedAt)) {
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
    const delivery = await deliverAuthCode(c, { email, code: result.code, purpose: 'verify_email', fullName });
    if (delivery.error) return c.json({ error: delivery.error, user: result.user }, 502);
    return c.json({ user: result.user, sent: delivery.sent, devCode: delivery.devCode }, 201);
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
      return { code, fullName: user.fullName ?? null };
    });

    if ('error' in result) return c.json({ error: result.error }, result.status as 404 | 409 | 429);
    const delivery = await deliverAuthCode(c, { email, code: result.code, purpose: 'verify_email', fullName: result.fullName });
    if (delivery.error) return c.json({ error: delivery.error }, 502);
    return c.json({ sent: delivery.sent, devCode: delivery.devCode });
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
        return { error: 'Verify your email before logging in.', status: 403 as const, code, fullName: user.fullName ?? null };
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
      const delivery = 'code' in result && typeof result.code === 'string'
        ? await deliverAuthCode(c, { email, code: result.code, purpose: 'verify_email', fullName: result.fullName ?? null })
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
      return { sent: true, code, fullName: user.fullName ?? null };
    });
    if ('code' in result && typeof result.code === 'string') {
      const delivery = await deliverAuthCode(c, { email, code: result.code, purpose: 'password_reset', fullName: result.fullName ?? null });
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
    const plan = PREMIUM_PLANS.find((p) => p.id === planId);
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
        return c.json({ user: publicUser(auth.user), checkoutUrl: session.url, sessionId: session.id, verified: false });
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Could not start Stripe Checkout.' }, 502);
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
      const user = db.users.find((u) => u.id === auth.user.id && !u.deletedAt);
      if (!user) return { error: 'Account not found.', status: 404 as const };
      const purchase = activatePaidPlan(db, user, planId, `dev_${randomUUID()}`, 'stripe-dev', { planId, amountCents: plan.amountCents });
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
    if (!/^cs_(test|live)_/.test(sessionId)) return c.json({ error: 'Missing Stripe Checkout session.' }, 400);

    try {
      const session = await stripeRequest<{
        id: string;
        status?: string;
        payment_status?: string;
        client_reference_id?: string | null;
        metadata?: { userId?: string; planId?: string };
      }>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
      const planId = session.metadata?.planId as PlanId | undefined;
      if (session.client_reference_id !== auth.user.id && session.metadata?.userId !== auth.user.id) return c.json({ error: 'This checkout session belongs to another account.' }, 403);
      if (!planId || !PREMIUM_PLANS.some((plan) => plan.id === planId)) return c.json({ error: 'Stripe session is missing the FileMint plan.' }, 400);
      if (session.payment_status !== 'paid' && session.status !== 'complete') return c.json({ error: 'Stripe has not confirmed this payment yet.' }, 402);

      const result = await mutateDb((db) => {
        const user = db.users.find((u) => u.id === auth.user.id && !u.deletedAt);
        if (!user) return { error: 'Account not found.', status: 404 as const };
        const purchase = activatePaidPlan(db, user, planId, session.id, 'stripe', { sessionId: session.id, status: session.status, paymentStatus: session.payment_status });
        return { user: publicUser(user), purchase };
      });

      if ('error' in result) return c.json({ error: result.error }, result.status);
      return c.json({ user: result.user, purchase: result.purchase, verified: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Could not confirm Stripe payment.' }, 502);
    }
  });

  app.post('/auth/stripe/webhook', async (c) => {
    const rawBody = await c.req.text();
    if (!verifyStripeWebhook(rawBody, c.req.header('stripe-signature'))) {
      return c.json({ error: 'Invalid Stripe webhook signature.' }, 400);
    }
    const event = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      data?: { object?: { id?: string; payment_status?: string; status?: string; client_reference_id?: string | null; metadata?: { userId?: string; planId?: string } } };
    };
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      const userId = session?.metadata?.userId || session?.client_reference_id || null;
      const planId = session?.metadata?.planId as PlanId | undefined;
      const sessionId = session?.id;
      if (sessionId && userId && planId && (session.payment_status === 'paid' || session.status === 'complete')) {
        await mutateDb((db) => {
          const user = db.users.find((u) => u.id === userId && !u.deletedAt);
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
