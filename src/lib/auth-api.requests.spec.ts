import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, authApi } from './auth-api';

const getServerBaseUrl = vi.hoisted(() => vi.fn(() => 'http://localhost:8787/'));
vi.mock('@/lib/api', () => ({ getServerBaseUrl }));

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('authentication API contract', () => {
  beforeEach(() => getServerBaseUrl.mockReturnValue('http://localhost:8787/'));

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends signup JSON with the expected endpoint and content type', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ user: { id: 'user-1' }, sent: true }));
    vi.stubGlobal('fetch', fetchMock);
    const input = {
      email: 'person@example.com',
      username: 'person',
      password: 'S3cure password!',
      fullName: 'Test Person',
      phone: '+992000000000',
    };

    await authApi.signup(input);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:8787/auth/signup');
    expect(options).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
    expect((options!.headers as Headers).get('content-type')).toBe('application/json');
  });

  it('encodes username queries and attaches bearer tokens only when supplied', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.checkUsername('first last+tag');
    await authApi.me('session-token');
    await authApi.logout(null);

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://localhost:8787/auth/username?username=first%20last%2Btag',
    );
    expect((fetchMock.mock.calls[1][1]!.headers as Headers).get('authorization')).toBe(
      'Bearer session-token',
    );
    expect((fetchMock.mock.calls[2][1]!.headers as Headers).has('authorization')).toBe(false);
  });

  it('keeps premium checkout and account mutations aligned with the server API', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.checkout('token', 'year');
    await authApi.confirmCheckout('token', 'checkout-7');
    await authApi.changePassword('token', { currentPassword: 'old', newPassword: 'new' });
    await authApi.deleteAccount('token');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8787/premium/checkout',
      'http://localhost:8787/premium/checkout/confirm',
      'http://localhost:8787/auth/change-password',
      'http://localhost:8787/auth/account',
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ planId: 'year', provider: 'stripe' }),
    });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: 'DELETE' });
  });

  it('covers the remaining session, recovery, and premium action contracts', async () => {
    const fetchMock = vi.fn<FetchFn>(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.resendCode('person@example.com');
    await authApi.login({ email: 'person@example.com', password: 'password1' });
    await authApi.confirmPasswordReset({ email: 'person@example.com', code: '123456', password: 'newpass1' });
    await authApi.restore('token');
    await authApi.manage('token');

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:8787/auth/resend-code',
      'http://localhost:8787/auth/login',
      'http://localhost:8787/auth/password-reset/confirm',
      'http://localhost:8787/premium/restore',
      'http://localhost:8787/premium/manage',
    ]);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options!.method).toBe('POST');
    }
  });

  it('preserves structured and plain-text server failures in ApiError', async () => {
    const fetchMock = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(jsonResponse({ error: 'Invalid verification code.' }, 400))
      .mockResolvedValueOnce(new Response('upstream unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const structured = await authApi
      .verifyEmail({ email: 'person@example.com', code: '000000' })
      .catch((e) => e);
    expect(structured).toBeInstanceOf(ApiError);
    expect(structured).toMatchObject({
      status: 400,
      message: 'Invalid verification code.',
      data: { error: 'Invalid verification code.' },
    });

    const plain = await authApi.plans().catch((e) => e);
    expect(plain).toMatchObject({
      status: 503,
      message: 'Request failed (503).',
      data: 'upstream unavailable',
    });
  });

  it('returns an actionable status-zero error when the server cannot be reached', async () => {
    getServerBaseUrl.mockReturnValue('https://api.example.com/');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const error = await authApi.requestPasswordReset('person@example.com').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 0,
      data: null,
      message: `Can't reach the FileMint server at https://api.example.com. Start it with "npm run server".`,
    });
  });
});
