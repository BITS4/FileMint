import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type AuthUser, isPremiumUser } from './auth-api';

vi.mock('@/lib/api', () => ({ getServerBaseUrl: () => 'http://localhost:8787' }));

const baseUser: AuthUser = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  premiumStatus: 'free',
  lifetimePremium: false,
};

describe('auth API helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('preserves server response details on API errors', () => {
    const data = { error: 'Invalid code' };
    const error = new ApiError('Invalid code', 400, data);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: 'Invalid code', status: 400, data });
  });

  it('recognizes lifetime and non-expiring active access', () => {
    expect(isPremiumUser({ ...baseUser, lifetimePremium: true })).toBe(true);
    expect(isPremiumUser({ ...baseUser, premiumStatus: 'active', premiumExpiresAt: null })).toBe(true);
    expect(isPremiumUser(null)).toBe(false);
  });

  it('rejects expired access and accepts a future expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'));

    expect(
      isPremiumUser({ ...baseUser, premiumStatus: 'active', premiumExpiresAt: '2026-09-01T00:00:00.000Z' }),
    ).toBe(true);
    expect(
      isPremiumUser({ ...baseUser, premiumStatus: 'active', premiumExpiresAt: '2026-08-30T00:00:00.000Z' }),
    ).toBe(false);
    expect(isPremiumUser({ ...baseUser, premiumStatus: 'expired' })).toBe(false);
  });
});
