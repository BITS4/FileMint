export const SESSION_MS = 60 * 60 * 1000;
export const SESSION_WARNING_MS = 5 * 60 * 1000;
export const CODE_MS = 10 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanId = 'week' | 'month' | 'year' | 'forever';
export type CodePurpose = 'verify_email' | 'password_reset';
export type PremiumStatus = 'free' | 'active' | 'expired' | 'canceled' | 'refunded';

export interface PasswordRecord {
  salt: string;
  hash: string;
}

export interface UserRecord {
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

export interface CodeRecord {
  id: string;
  email: string;
  userId?: string | null;
  purpose: CodePurpose;
  codeHash: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface PurchaseRecord {
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

export interface PaymentEventRecord {
  id: string;
  userId?: string | null;
  purchaseId?: string | null;
  provider: string;
  type: string;
  status: string;
  createdAt: string;
  payload?: Record<string, unknown>;
}

export interface UsageRecord {
  userId: string;
  date: string;
  conversions: number;
  ocrTasks: number;
  compressions: number;
  scans: number;
  batchJobs: number;
}

export interface AuthDb {
  users: UserRecord[];
  codes: CodeRecord[];
  sessions: SessionRecord[];
  purchases: PurchaseRecord[];
  paymentEvents: PaymentEventRecord[];
  usage: UsageRecord[];
}

export interface PublicUser {
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

export const LIMITS = {
  signup: { count: 5, windowMs: 15 * 60 * 1000 },
  login: { count: 10, windowMs: 15 * 60 * 1000 },
  code: { count: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { count: 5, windowMs: 60 * 60 * 1000 },
  checkout: { count: 12, windowMs: 10 * 60 * 1000 },
};

export const FREE_USAGE_LIMITS: Record<keyof Omit<UsageRecord, 'userId' | 'date'>, number> = {
  conversions: 10,
  ocrTasks: 2,
  compressions: 5,
  scans: 10,
  batchJobs: 0,
};
