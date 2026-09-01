import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appBaseUrl, deliverAuthCode } from './auth.email';

function baseApp() {
  const app = new Hono();
  app.get('/base', (context) => context.text(appBaseUrl(context)));
  return app;
}

function deliveryApp(purpose: 'verify_email' | 'password_reset' = 'verify_email') {
  const app = new Hono();
  app.post('/send', async (context) =>
    context.json(
      await deliverAuthCode(context, {
        email: 'reader@example.com',
        code: '123456',
        purpose,
        fullName: `Reader <&>"'`,
      }),
    ),
  );
  return app;
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('authentication email base URL', () => {
  it('prefers configured public URLs and removes trailing slashes', async () => {
    vi.stubEnv('FILEMINT_PUBLIC_URL', 'https://files.example.com///');
    expect(await (await baseApp().request('/base')).text()).toBe('https://files.example.com');

    vi.stubEnv('FILEMINT_PUBLIC_URL', '');
    vi.stubEnv('PUBLIC_APP_URL', 'https://public.example.com/');
    expect(await (await baseApp().request('/base')).text()).toBe('https://public.example.com');

    vi.stubEnv('PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', 'https://legacy.example.com/');
    expect(await (await baseApp().request('/base')).text()).toBe('https://legacy.example.com');
  });

  it('uses request origins, forwarded protocols, and safe local defaults', async () => {
    vi.stubEnv('FILEMINT_PUBLIC_URL', '');
    vi.stubEnv('PUBLIC_APP_URL', '');
    vi.stubEnv('APP_URL', '');

    expect(
      await (await baseApp().request('/base', { headers: { origin: 'https://origin.example.com/' } })).text(),
    ).toBe('https://origin.example.com');
    expect(
      await (
        await baseApp().request('/base', {
          headers: { host: 'files.example.com', 'x-forwarded-proto': 'http' },
        })
      ).text(),
    ).toBe('http://files.example.com');
    expect(await (await baseApp().request('/base', { headers: { host: 'files.example.com' } })).text()).toBe(
      'https://files.example.com',
    );
    expect(await (await baseApp().request('/base')).text()).toBe('http://localhost:8787');
  });
});

describe('authentication code delivery', () => {
  it('returns development codes for verification and reset messages without network calls', async () => {
    const verify = await deliveryApp().request('/send', { method: 'POST' });
    expect(await verify.json()).toEqual({ sent: false, devCode: '123456' });
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('Verification code'));

    const reset = await deliveryApp('password_reset').request('/send', { method: 'POST' });
    expect(await reset.json()).toEqual({ sent: false, devCode: '123456' });
    expect(console.info).toHaveBeenLastCalledWith(expect.stringContaining('Password reset code'));
  });

  it('fails closed in production-like environments without provider credentials', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const production = await deliveryApp().request('/send', { method: 'POST' });
    expect(await production.json()).toMatchObject({
      sent: false,
      error: expect.stringContaining('not configured'),
    });

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('FILEMINT_PRODUCTION', 'true');
    const hosted = await deliveryApp().request('/send', { method: 'POST' });
    expect(await hosted.json()).toMatchObject({
      sent: false,
      error: expect.stringContaining('RESEND_API_KEY'),
    });
  });

  it('sends escaped verification email payloads through the configured provider', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('FILEMINT_EMAIL_FROM', 'FileMint <hello@example.com>');
    vi.stubEnv('FILEMINT_PUBLIC_URL', 'https://app.example.com');
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await deliveryApp().request('/send', { method: 'POST' });

    expect(await response.json()).toEqual({ sent: true });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer resend-key' });
    const payload = JSON.parse(String(request.body));
    expect(payload.subject).toBe('Verify your FileMint email');
    expect(payload.html).toContain('Reader &lt;&amp;&gt;&quot;&#39;');
    expect(payload.html).toContain('email=reader%40example.com&amp;code=123456');
    expect(payload.text).toContain('Verify: https://app.example.com/auth/verify?');
  });

  it('reports provider rejections including a bounded response body', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM', 'hello@example.com');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('provider says no'.repeat(40), { status: 429 })),
    );

    const response = await deliveryApp('password_reset').request('/send', { method: 'POST' });
    const body = await response.json();
    expect(body.sent).toBe(false);
    expect(body.error).toContain('429');
    expect(body.error.length).toBeLessThan(330);

    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 503, text: () => Promise.reject(new Error('unreadable')) }),
    );
    expect(await (await deliveryApp().request('/send', { method: 'POST' })).json()).toMatchObject({
      sent: false,
      error: expect.stringContaining('503'),
    });
  });

  it('reports thrown provider errors and non-Error rejections', async () => {
    vi.stubEnv('RESEND_API_KEY', 'resend-key');
    vi.stubEnv('RESEND_FROM', 'hello@example.com');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network offline')));
    expect(await (await deliveryApp().request('/send', { method: 'POST' })).json()).toMatchObject({
      sent: false,
      error: 'network offline',
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce('offline'));
    expect(await (await deliveryApp().request('/send', { method: 'POST' })).json()).toMatchObject({
      sent: false,
      error: 'Email provider request failed.',
    });
  });
});
