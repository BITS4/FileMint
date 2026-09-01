import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import type { Context } from 'hono';
import {
  CODE_MS,
  LIMITS,
  SESSION_MS,
  SESSION_WARNING_MS,
  type AuthDb,
  type CodePurpose,
  type PasswordRecord,
  type PlanId,
  type PublicUser,
  type SessionRecord,
  type UsageRecord,
  type UserRecord,
} from './auth.models';
import { loadDb, prune } from './auth.store';

const scrypt = promisify(scryptCb);
const USERNAME_RE = /^[A-Za-z0-9_]{6,}$/;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function normalizeEmail(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeUsername(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function validateUsername(username: string): string | null {
  if (!username) return 'Choose a username.';
  if (username.length < 6) return 'Username must be at least 6 characters.';
  if (!USERNAME_RE.test(username)) return 'Use only letters, numbers, and underscore.';
  return null;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isStrongPassword(value: string): boolean {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function addMs(ms: number, start = new Date()): string {
  return new Date(start.getTime() + ms).toISOString();
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function tokenHash(token: string): string {
  return hash(`session:${token}`);
}

export function codeHash(email: string, purpose: CodePurpose, code: string): string {
  return hash(`code:${purpose}:${email}:${code}`);
}

export function syncPremium(user: UserRecord): void {
  if (user.lifetimePremium) {
    user.premiumStatus = 'active';
    user.premiumExpiresAt = null;
    return;
  }
  if (
    user.premiumStatus === 'active' &&
    user.premiumExpiresAt &&
    new Date(user.premiumExpiresAt).getTime() <= Date.now()
  ) {
    user.premiumStatus = 'expired';
  }
}

export function publicUser(user: UserRecord): PublicUser {
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

export async function hashPassword(password: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return { salt, hash: key.toString('hex') };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const key = (await scrypt(password, record.salt, 64)) as Buffer;
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length !== key.length) return false;
  return timingSafeEqual(expected, key);
}

function createCode(): string {
  return String(randomInt(100000, 1000000));
}

export function issueCode(db: AuthDb, email: string, purpose: CodePurpose, userId?: string | null): string {
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

export function isActivePremium(user: UserRecord): boolean {
  syncPremium(user);
  return user.lifetimePremium || user.premiumStatus === 'active';
}

export function expiryFor(planId: PlanId, start: Date): string | null {
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

export function rateLimited(c: Context, action: keyof typeof LIMITS, email?: string): string | null {
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

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function authenticate(
  c: Context,
): Promise<{ db: AuthDb; user: UserRecord; session: SessionRecord } | null> {
  const header = c.req.header('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return null;
  const hashed = tokenHash(match[1]);
  const db = await loadDb();
  prune(db);
  const session = db.sessions.find((item) => item.tokenHash === hashed && !item.revokedAt);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  const user = db.users.find((item) => item.id === session.userId && !item.deletedAt);
  if (!user) return null;
  syncPremium(user);
  return { db, user, session };
}

export function authResponse(user: UserRecord, token: string, expiresAt: string) {
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

export function getUsage(db: AuthDb, userId: string): UsageRecord {
  const date = new Date().toISOString().slice(0, 10);
  let usage = db.usage.find((item) => item.userId === userId && item.date === date);
  if (!usage) {
    usage = { userId, date, conversions: 0, ocrTasks: 0, compressions: 0, scans: 0, batchJobs: 0 };
    db.usage.push(usage);
  }
  return usage;
}
