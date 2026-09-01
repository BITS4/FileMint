import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthUser, CheckoutResponse, PremiumPlan } from '@/lib/auth-api';

const mocks = vi.hoisted(() => {
  class MockApiError extends Error {
    status: number;
    data: unknown;

    constructor(message: string, status: number, data: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }

  return {
    ApiError: MockApiError,
    asyncStorage: { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() },
    authApi: {
      signup: vi.fn(),
      checkUsername: vi.fn(),
      verifyEmail: vi.fn(),
      resendCode: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      me: vi.fn(),
      requestPasswordReset: vi.fn(),
      confirmPasswordReset: vi.fn(),
      plans: vi.fn(),
      checkout: vi.fn(),
      confirmCheckout: vi.fn(),
      restore: vi.fn(),
      manage: vi.fn(),
      changePassword: vi.fn(),
      deleteAccount: vi.fn(),
    },
    isPremiumUser: vi.fn(
      (
        user:
          | {
              lifetimePremium: boolean;
              premiumStatus: string;
              premiumExpiresAt?: string | null;
            }
          | null
          | undefined,
      ) =>
        Boolean(
          user &&
          (user.lifetimePremium ||
            (user.premiumStatus === 'active' &&
              (!user.premiumExpiresAt || new Date(user.premiumExpiresAt).getTime() > Date.now()))),
        ),
    ),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({ default: mocks.asyncStorage }));
vi.mock('@/lib/auth-api', () => ({
  ApiError: mocks.ApiError,
  authApi: mocks.authApi,
  isPremiumUser: mocks.isPremiumUser,
}));

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'reader@example.com',
    username: 'reader_1',
    emailVerified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    premiumStatus: 'free',
    lifetimePremium: false,
    ...overrides,
  };
}

function plan(overrides: Partial<PremiumPlan> = {}): PremiumPlan {
  return {
    id: 'month',
    name: 'Monthly',
    shortName: 'Month',
    price: '$4.99',
    amountCents: 499,
    durationLabel: '1 month',
    ...overrides,
  };
}

function checkout(account = user({ premiumStatus: 'active' })): CheckoutResponse {
  return {
    user: account,
    checkoutUrl: 'https://checkout.example/session',
    sessionId: 'checkout-1',
    verified: true,
  };
}

type AuthModule = typeof import('./useAuth');
let authModule: AuthModule;

async function resetStore() {
  vi.resetModules();
  authModule = await import('./useAuth');
  await authModule.useAuth.persist.rehydrate();
  authModule.useAuth.setState({
    user: null,
    token: null,
    sessionExpiresAt: null,
    sessionWarningAt: null,
    plans: [],
    loading: false,
    error: null,
    devCode: null,
    hydrated: true,
  });
  mocks.asyncStorage.setItem.mockClear();
}

describe('authentication store', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    for (const mock of Object.values(mocks.authApi)) mock.mockReset();
    mocks.isPremiumUser.mockClear();
    mocks.asyncStorage.getItem.mockReset().mockResolvedValue(null);
    mocks.asyncStorage.removeItem.mockReset().mockResolvedValue(undefined);
    mocks.asyncStorage.setItem.mockReset().mockResolvedValue(undefined);
    await resetStore();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('manages local session state and evaluates login and premium selectors', () => {
    const { selectIsLoggedIn, selectIsPremium, useAuth } = authModule;
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    useAuth.getState().setError('old error');
    expect(useAuth.getState().error).toBe('old error');
    const account = user({ lifetimePremium: true });
    useAuth.setState({
      user: account,
      token: 'token-1',
      sessionExpiresAt: '2026-06-01T13:00:00.000Z',
      sessionWarningAt: '2026-06-01T12:55:00.000Z',
      devCode: '123456',
    });
    expect(selectIsLoggedIn(useAuth.getState())).toBe(true);
    expect(selectIsPremium(useAuth.getState())).toBe(true);
    expect(mocks.isPremiumUser).toHaveBeenCalledWith(account);
    useAuth.setState({ sessionExpiresAt: '2026-06-01T11:59:59.000Z' });
    expect(selectIsLoggedIn(useAuth.getState())).toBe(false);
    useAuth.setState({ sessionExpiresAt: null });
    expect(selectIsLoggedIn(useAuth.getState())).toBe(true);
    useAuth.setState({ token: null });
    expect(selectIsLoggedIn(useAuth.getState())).toBe(false);
    useAuth.getState().clearSession();
    expect(useAuth.getState()).toMatchObject({
      user: null,
      token: null,
      sessionExpiresAt: null,
      sessionWarningAt: null,
      error: null,
      devCode: null,
    });
  });

  it('persists only durable fields and marks restored state as hydrated', async () => {
    const account = user();
    authModule.useAuth.setState({
      user: account,
      token: 'persisted-token',
      sessionExpiresAt: '2027-01-01T00:00:00.000Z',
      sessionWarningAt: '2026-12-31T23:55:00.000Z',
      plans: [plan()],
      loading: true,
      error: 'transient',
      devCode: '654321',
      hydrated: true,
    });

    await vi.waitFor(() => expect(mocks.asyncStorage.setItem).toHaveBeenCalled());
    const [key, serialized] = mocks.asyncStorage.setItem.mock.calls.at(-1) as [string, string];
    const persisted = JSON.parse(serialized) as { state: Record<string, unknown> };
    expect(key).toBe('filemint-auth');
    expect(persisted.state).toEqual({
      user: account,
      token: 'persisted-token',
      sessionExpiresAt: '2027-01-01T00:00:00.000Z',
      sessionWarningAt: '2026-12-31T23:55:00.000Z',
      plans: [plan()],
      devCode: '654321',
    });
    expect(persisted.state).not.toHaveProperty('loading');
    expect(persisted.state).not.toHaveProperty('error');
    expect(persisted.state).not.toHaveProperty('hydrated');

    mocks.asyncStorage.getItem.mockResolvedValue(serialized);
    vi.resetModules();
    const restored = await import('./useAuth');
    await restored.useAuth.persist.rehydrate();
    expect(restored.useAuth.getState()).toMatchObject({
      user: account,
      token: 'persisted-token',
      loading: false,
      error: null,
      hydrated: true,
    });
  });

  it('signs up, checks a username, verifies email, and resends codes', async () => {
    const pending = user({ emailVerified: false });
    const verified = user({ emailVerified: true });
    mocks.authApi.signup.mockResolvedValue({ user: pending, devCode: '111111' });
    mocks.authApi.checkUsername.mockResolvedValue({
      username: 'reader_1',
      valid: true,
      available: true,
      message: 'Available.',
    });
    mocks.authApi.verifyEmail.mockResolvedValue({ user: verified });
    mocks.authApi.resendCode
      .mockResolvedValueOnce({ sent: true, devCode: '222222' })
      .mockResolvedValueOnce({ sent: true });
    await authModule.useAuth.getState().signup({
      email: pending.email,
      username: pending.username!,
      password: 'FileMint9',
      fullName: 'Reader',
      phone: '',
    });
    expect(authModule.useAuth.getState()).toMatchObject({
      user: pending,
      devCode: '111111',
      loading: false,
      error: null,
    });
    await expect(authModule.useAuth.getState().checkUsername('reader_1')).resolves.toEqual({
      valid: true,
      available: true,
      message: 'Available.',
    });
    await authModule.useAuth.getState().verifyEmail({ email: pending.email, code: '111111' });
    expect(authModule.useAuth.getState()).toMatchObject({ user: verified, devCode: null, loading: false });
    await expect(authModule.useAuth.getState().resendCode(pending.email)).resolves.toBe('222222');
    await expect(authModule.useAuth.getState().resendCode(pending.email)).resolves.toBeNull();
    expect(authModule.useAuth.getState()).toMatchObject({ devCode: null, loading: false });
  });

  it('records signup, verification, and resend failures and always clears loading', async () => {
    mocks.authApi.signup.mockRejectedValue('offline');
    await expect(
      authModule.useAuth.getState().signup({
        email: 'reader@example.com',
        username: 'reader_1',
        password: 'FileMint9',
        fullName: 'Reader',
        phone: '',
      }),
    ).rejects.toBe('offline');
    expect(authModule.useAuth.getState()).toMatchObject({
      error: 'Something went wrong.',
      loading: false,
    });
    mocks.authApi.verifyEmail.mockRejectedValue(new Error('Invalid code.'));
    await expect(
      authModule.useAuth.getState().verifyEmail({ email: 'reader@example.com', code: 'bad' }),
    ).rejects.toThrow('Invalid code.');
    expect(authModule.useAuth.getState()).toMatchObject({ error: 'Invalid code.', loading: false });
    mocks.authApi.resendCode.mockRejectedValue(new Error('Please wait.'));
    await expect(authModule.useAuth.getState().resendCode('reader@example.com')).rejects.toThrow(
      'Please wait.',
    );
    expect(authModule.useAuth.getState()).toMatchObject({ error: 'Please wait.', loading: false });
  });

  it('stores a successful login session and preserves a verification code from API errors', async () => {
    const account = user();
    mocks.authApi.login.mockResolvedValueOnce({
      user: account,
      session: {
        token: 'token-1',
        expiresAt: '2027-01-01T00:00:00.000Z',
        warningAt: '2026-12-31T23:55:00.000Z',
      },
    });
    await authModule.useAuth.getState().login({ email: account.email, password: 'FileMint9' });
    expect(authModule.useAuth.getState()).toMatchObject({
      user: account,
      token: 'token-1',
      sessionExpiresAt: '2027-01-01T00:00:00.000Z',
      sessionWarningAt: '2026-12-31T23:55:00.000Z',
      devCode: null,
      loading: false,
    });
    const verificationError = new mocks.ApiError('Verify your email.', 403, { devCode: '333333' });
    mocks.authApi.login.mockRejectedValueOnce(verificationError);
    await expect(
      authModule.useAuth.getState().login({ email: account.email, password: 'FileMint9' }),
    ).rejects.toBe(verificationError);
    expect(authModule.useAuth.getState()).toMatchObject({
      error: 'Verify your email.',
      devCode: '333333',
      loading: false,
    });
    const genericError = new mocks.ApiError('Denied.', 401, null);
    mocks.authApi.login.mockRejectedValueOnce(genericError);
    await expect(
      authModule.useAuth.getState().login({ email: account.email, password: 'wrong' }),
    ).rejects.toBe(genericError);
    expect(authModule.useAuth.getState()).toMatchObject({ error: 'Denied.', devCode: null, loading: false });
  });

  it('clears local credentials on logout even when the server is unavailable', async () => {
    authModule.useAuth.setState({ user: user(), token: 'token-1', error: 'old', devCode: '123456' });
    mocks.authApi.logout.mockRejectedValue(new Error('offline'));

    await expect(authModule.useAuth.getState().logout()).resolves.toBeUndefined();
    expect(mocks.authApi.logout).toHaveBeenCalledWith('token-1');
    expect(authModule.useAuth.getState()).toMatchObject({
      user: null,
      token: null,
      error: null,
      devCode: null,
      loading: false,
    });
  });

  it('refreshes valid sessions and clears missing, expired, or rejected sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    const refreshed = user({ fullName: 'Refreshed Reader' });

    await authModule.useAuth.getState().refreshMe();
    expect(mocks.authApi.me).not.toHaveBeenCalled();

    authModule.useAuth.setState({
      user: user(),
      token: 'expired-token',
      sessionExpiresAt: '2026-06-01T11:00:00.000Z',
    });
    await authModule.useAuth.getState().refreshMe();
    expect(authModule.useAuth.getState().token).toBeNull();

    authModule.useAuth.setState({
      user: user(),
      token: 'valid-token',
      sessionExpiresAt: '2026-06-01T13:00:00.000Z',
    });
    mocks.authApi.me.mockResolvedValueOnce({
      user: refreshed,
      session: {
        expiresAt: '2026-06-01T14:00:00.000Z',
        warningAt: '2026-06-01T13:55:00.000Z',
      },
    });
    await authModule.useAuth.getState().refreshMe();
    expect(authModule.useAuth.getState()).toMatchObject({
      user: refreshed,
      token: 'valid-token',
      sessionExpiresAt: '2026-06-01T14:00:00.000Z',
      error: null,
    });

    const rejected = new Error('Session revoked.');
    mocks.authApi.me.mockRejectedValueOnce(rejected);
    await expect(authModule.useAuth.getState().refreshMe()).rejects.toBe(rejected);
    expect(authModule.useAuth.getState()).toMatchObject({ user: null, token: null });
  });

  it('requests and confirms password resets across success and error paths', async () => {
    mocks.authApi.requestPasswordReset
      .mockResolvedValueOnce({ sent: true, devCode: '444444' })
      .mockResolvedValueOnce({ sent: true });
    await expect(authModule.useAuth.getState().requestPasswordReset('reader@example.com')).resolves.toBe(
      '444444',
    );
    await expect(
      authModule.useAuth.getState().requestPasswordReset('reader@example.com'),
    ).resolves.toBeNull();

    mocks.authApi.requestPasswordReset.mockRejectedValueOnce(new Error('Reset blocked.'));
    await expect(authModule.useAuth.getState().requestPasswordReset('reader@example.com')).rejects.toThrow(
      'Reset blocked.',
    );
    expect(authModule.useAuth.getState()).toMatchObject({ error: 'Reset blocked.', loading: false });

    authModule.useAuth.setState({ user: user(), token: 'token-1' });
    mocks.authApi.confirmPasswordReset.mockResolvedValueOnce({ ok: true });
    await authModule.useAuth
      .getState()
      .confirmPasswordReset({ email: 'reader@example.com', code: '444444', password: 'Changed9' });
    expect(authModule.useAuth.getState()).toMatchObject({ user: null, token: null, loading: false });

    mocks.authApi.confirmPasswordReset.mockRejectedValueOnce(new Error('Code expired.'));
    await expect(
      authModule.useAuth
        .getState()
        .confirmPasswordReset({ email: 'reader@example.com', code: '444444', password: 'Changed9' }),
    ).rejects.toThrow('Code expired.');
    expect(authModule.useAuth.getState()).toMatchObject({ error: 'Code expired.', loading: false });
  });

  it('loads plans and completes every authenticated premium and account action', async () => {
    const free = user();
    const premium = user({ premiumStatus: 'active', premiumExpiresAt: '2027-01-01T00:00:00.000Z' });
    mocks.authApi.plans.mockResolvedValueOnce({ plans: [plan()] });
    await authModule.useAuth.getState().loadPlans();
    expect(authModule.useAuth.getState().plans).toEqual([plan()]);
    mocks.authApi.plans.mockRejectedValueOnce(new Error('offline'));
    await expect(authModule.useAuth.getState().loadPlans()).resolves.toBeUndefined();
    expect(authModule.useAuth.getState().plans).toEqual([plan()]);

    authModule.useAuth.setState({ user: free, token: 'token-1' });
    const checkoutResponse = checkout(premium);
    mocks.authApi.checkout.mockResolvedValue(checkoutResponse);
    await expect(authModule.useAuth.getState().buyPlan('month')).resolves.toEqual(checkoutResponse);
    expect(mocks.authApi.checkout).toHaveBeenCalledWith('token-1', 'month');

    mocks.authApi.confirmCheckout.mockResolvedValue(checkoutResponse);
    await authModule.useAuth.getState().confirmCheckout('checkout-1');
    expect(mocks.authApi.confirmCheckout).toHaveBeenCalledWith('token-1', 'checkout-1');

    mocks.authApi.restore.mockResolvedValue({ user: premium, restored: true });
    await expect(authModule.useAuth.getState().restorePurchases()).resolves.toBe(true);
    mocks.authApi.manage.mockResolvedValue({ user: premium, message: 'Portal opened.' });
    await expect(authModule.useAuth.getState().manageSubscription()).resolves.toBe('Portal opened.');
    mocks.authApi.changePassword.mockResolvedValue({ user: premium });
    await authModule.useAuth
      .getState()
      .changePassword({ currentPassword: 'FileMint9', newPassword: 'Changed9' });
    expect(mocks.authApi.changePassword).toHaveBeenCalledWith('token-1', {
      currentPassword: 'FileMint9',
      newPassword: 'Changed9',
    });

    mocks.authApi.deleteAccount.mockResolvedValue({ ok: true });
    await authModule.useAuth.getState().deleteAccount();
    expect(mocks.authApi.deleteAccount).toHaveBeenCalledWith('token-1');
    expect(authModule.useAuth.getState()).toMatchObject({ user: null, token: null, loading: false });
  });

  it('rejects authenticated actions before calling the API when there is no session', async () => {
    await expect(authModule.useAuth.getState().buyPlan('month')).rejects.toThrow(
      'Log in before buying Premium.',
    );
    await expect(authModule.useAuth.getState().confirmCheckout('checkout-1')).rejects.toThrow(
      'Log in before confirming Premium.',
    );
    await expect(authModule.useAuth.getState().restorePurchases()).rejects.toThrow(
      'Log in to restore purchases.',
    );
    await expect(authModule.useAuth.getState().manageSubscription()).rejects.toThrow(
      'Log in to manage your subscription.',
    );
    await expect(
      authModule.useAuth.getState().changePassword({ currentPassword: 'FileMint9', newPassword: 'Changed9' }),
    ).rejects.toThrow('Log in to change your password.');
    await expect(authModule.useAuth.getState().deleteAccount()).rejects.toThrow(
      'Log in to delete your account.',
    );
    for (const mock of [
      mocks.authApi.checkout,
      mocks.authApi.confirmCheckout,
      mocks.authApi.restore,
      mocks.authApi.manage,
      mocks.authApi.changePassword,
      mocks.authApi.deleteAccount,
    ]) {
      expect(mock).not.toHaveBeenCalled();
    }
  });

  it('records API failures and clears loading for every authenticated mutation', async () => {
    authModule.useAuth.setState({ user: user(), token: 'token-1' });
    const attempts = [
      [mocks.authApi.checkout, () => authModule.useAuth.getState().buyPlan('month')],
      [mocks.authApi.confirmCheckout, () => authModule.useAuth.getState().confirmCheckout('checkout-1')],
      [mocks.authApi.restore, () => authModule.useAuth.getState().restorePurchases()],
      [mocks.authApi.manage, () => authModule.useAuth.getState().manageSubscription()],
      [
        mocks.authApi.changePassword,
        () =>
          authModule.useAuth
            .getState()
            .changePassword({ currentPassword: 'FileMint9', newPassword: 'Changed9' }),
      ],
      [mocks.authApi.deleteAccount, () => authModule.useAuth.getState().deleteAccount()],
    ] as const;

    for (const [apiMock, invoke] of attempts) {
      const failure = new Error(`failed-${apiMock.getMockName()}`);
      apiMock.mockRejectedValueOnce(failure);
      await expect(invoke()).rejects.toBe(failure);
      expect(authModule.useAuth.getState()).toMatchObject({ error: failure.message, loading: false });
    }
  });
});
