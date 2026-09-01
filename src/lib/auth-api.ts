import { getServerBaseUrl } from '@/lib/api';

export type PlanId = 'week' | 'month' | 'year' | 'forever';
export type PremiumStatus = 'free' | 'active' | 'expired' | 'canceled' | 'refunded';

export interface AuthUser {
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

export interface AuthSession {
  token: string;
  expiresAt: string;
  warningAt: string;
  maxAgeSeconds?: number;
}

export interface PremiumPlan {
  id: PlanId;
  name: string;
  shortName: string;
  price: string;
  amountCents: number;
  durationLabel: string;
  bestValue?: boolean;
}

export interface AuthResponse {
  user: AuthUser;
  session: AuthSession;
}

export interface SignupResponse {
  user: AuthUser;
  sent?: boolean;
  devCode?: string;
}

export interface CodeResponse {
  sent?: boolean;
  devCode?: string;
}

export interface CheckoutResponse {
  user: AuthUser;
  checkoutUrl?: string;
  sessionId?: string;
  purchase?: {
    id: string;
    planId: PlanId;
    provider: string;
    status: string;
    startedAt: string;
    expiresAt?: string | null;
  };
  verified: boolean;
}

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function request<T>(path: string, options: RequestInit & { token?: string | null } = {}): Promise<T> {
  const base = getServerBaseUrl().replace(/\/+$/, '');
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(
      `Can't reach the FileMint server at ${base}. Start it with "npm run server".`,
      0,
      null,
    );
  }

  const text = await res.text();
  const data = text ? tryJson(text) : {};
  if (!res.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new ApiError(message, res.status, data);
  }
  return data as T;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function jsonBody(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

export const authApi = {
  signup(input: { email: string; username: string; password: string; fullName: string; phone: string }) {
    return request<SignupResponse>('/auth/signup', { method: 'POST', body: jsonBody(input) });
  },
  checkUsername(username: string) {
    return request<{ username: string; valid: boolean; available: boolean; message: string }>(
      `/auth/username?username=${encodeURIComponent(username)}`,
    );
  },
  verifyEmail(input: { email: string; code: string }) {
    return request<{ user: AuthUser }>('/auth/verify-email', { method: 'POST', body: jsonBody(input) });
  },
  resendCode(email: string) {
    return request<CodeResponse>('/auth/resend-code', { method: 'POST', body: jsonBody({ email }) });
  },
  login(input: { email: string; password: string }) {
    return request<AuthResponse & { emailVerificationRequired?: boolean; devCode?: string }>('/auth/login', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  logout(token: string | null) {
    return request<{ ok: boolean }>('/auth/logout', { method: 'POST', token });
  },
  me(token: string) {
    return request<{ user: AuthUser; session: Pick<AuthSession, 'expiresAt' | 'warningAt'> }>('/auth/me', {
      token,
    });
  },
  requestPasswordReset(email: string) {
    return request<CodeResponse>('/auth/password-reset/request', {
      method: 'POST',
      body: jsonBody({ email }),
    });
  },
  confirmPasswordReset(input: { email: string; code: string; password: string }) {
    return request<{ ok: boolean }>('/auth/password-reset/confirm', {
      method: 'POST',
      body: jsonBody(input),
    });
  },
  changePassword(token: string, input: { currentPassword: string; newPassword: string }) {
    return request<{ user: AuthUser }>('/auth/change-password', {
      method: 'POST',
      token,
      body: jsonBody(input),
    });
  },
  deleteAccount(token: string) {
    return request<{ ok: boolean }>('/auth/account', { method: 'DELETE', token });
  },
  plans() {
    return request<{ plans: PremiumPlan[] }>('/premium/plans');
  },
  checkout(token: string, planId: PlanId) {
    return request<CheckoutResponse>('/premium/checkout', {
      method: 'POST',
      token,
      body: jsonBody({ planId, provider: 'stripe' }),
    });
  },
  confirmCheckout(token: string, sessionId: string) {
    return request<CheckoutResponse>('/premium/checkout/confirm', {
      method: 'POST',
      token,
      body: jsonBody({ sessionId }),
    });
  },
  restore(token: string) {
    return request<{ user: AuthUser; restored: boolean }>('/premium/restore', { method: 'POST', token });
  },
  manage(token: string) {
    return request<{ user: AuthUser; message: string }>('/premium/manage', { method: 'POST', token });
  },
  submitFeedback(token: string, input: { type: 'feedback' | 'feature'; message: string }) {
    return request<{ ok: true; id: string }>('/feedback', {
      method: 'POST',
      token,
      body: jsonBody(input),
    });
  },
};

export function isPremiumUser(user: AuthUser | null | undefined): boolean {
  if (!user) return false;
  if (user.lifetimePremium) return true;
  if (user.premiumStatus !== 'active') return false;
  if (!user.premiumExpiresAt) return true;
  return new Date(user.premiumExpiresAt).getTime() > Date.now();
}
