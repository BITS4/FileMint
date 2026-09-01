import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';

import { createConversionIngressProtection, readConversionIngressConfig } from './ingress-protection';

function guardedApp(
  options: Parameters<typeof createConversionIngressProtection>[0] = {},
  route: (attempt: number, context: Context) => Response | Promise<Response> = (_attempt, context) =>
    context.text('ok'),
) {
  const protection = createConversionIngressProtection(options);
  const app = new Hono();
  let attempts = 0;
  app.use('*', protection.middleware);
  app.all('*', (context) => route(++attempts, context));
  app.onError(() => new Response('failed', { status: 500 }));
  return { app, protection };
}

describe('conversion ingress configuration', () => {
  it('uses safe defaults when values are absent or outside hard bounds', () => {
    expect(
      readConversionIngressConfig({
        FILEMINT_CONVERSION_RATE_LIMIT: '0',
        FILEMINT_CONVERSION_RATE_WINDOW_MS: '999',
        FILEMINT_CONVERSION_MAX_CONCURRENT: '65',
        FILEMINT_CONVERSION_BUSY_RETRY_SECONDS: '0',
        FILEMINT_CONVERSION_RATE_BUCKETS: '99',
        FILEMINT_TRUST_PROXY: 'TRUE',
      }),
    ).toEqual({
      maxRequests: 30,
      windowMs: 60_000,
      maxConcurrent: 2,
      busyRetrySeconds: 5,
      maxBuckets: 5_000,
      trustProxy: false,
    });
  });

  it('accepts bounded deployment overrides', () => {
    expect(
      readConversionIngressConfig({
        FILEMINT_CONVERSION_RATE_LIMIT: '12',
        FILEMINT_CONVERSION_RATE_WINDOW_MS: '30000',
        FILEMINT_CONVERSION_MAX_CONCURRENT: '3',
        FILEMINT_CONVERSION_BUSY_RETRY_SECONDS: '9',
        FILEMINT_CONVERSION_RATE_BUCKETS: '2000',
        FILEMINT_TRUST_PROXY: 'true',
      }),
    ).toEqual({
      maxRequests: 12,
      windowMs: 30_000,
      maxConcurrent: 3,
      busyRetrySeconds: 9,
      maxBuckets: 2_000,
      trustProxy: true,
    });
  });
});

describe('conversion ingress rate limiting', () => {
  it('returns deterministic rate headers and accepts the client after reset', async () => {
    let time = 1_000;
    const { app, protection } = guardedApp({
      config: { maxRequests: 2, windowMs: 10_000 },
      now: () => time,
      remoteAddress: () => '192.0.2.10',
    });

    expect((await app.request('/convert', { method: 'POST' })).status).toBe(200);
    const second = await app.request('/convert', { method: 'POST' });
    expect(second.status).toBe(200);
    expect(second.headers.get('x-ratelimit-limit')).toBe('2');
    expect(second.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(second.headers.get('x-ratelimit-reset')).toBe('11');

    const blocked = await app.request('/convert', { method: 'POST' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('10');
    await expect(blocked.json()).resolves.toEqual({
      error: 'Too many conversion requests. Try again after the rate-limit window resets.',
    });
    expect(protection.snapshot()).toMatchObject({ accepted: 2, rateLimitRejections: 1 });

    time = 11_000;
    expect((await app.request('/convert', { method: 'POST' })).status).toBe(200);
  });

  it('ignores spoofed forwarding headers unless the proxy is trusted', async () => {
    const direct = guardedApp({
      config: { maxRequests: 1, trustProxy: false },
      remoteAddress: () => '192.0.2.20',
    }).app;
    expect(
      (
        await direct.request('/ocr', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await direct.request('/ocr', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.2' },
        })
      ).status,
    ).toBe(429);

    const trusted = guardedApp({
      config: { maxRequests: 1, trustProxy: true },
      remoteAddress: () => '192.0.2.20',
    }).app;
    expect(
      (
        await trusted.request('/ocr', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await trusted.request('/ocr', {
          method: 'POST',
          headers: { 'x-forwarded-for': '198.51.100.2' },
        })
      ).status,
    ).toBe(200);
  });

  it('falls back to the socket address when trusted headers are malformed', async () => {
    const { app } = guardedApp({
      config: { maxRequests: 1, trustProxy: true },
      remoteAddress: () => '192.0.2.30',
    });
    const headers = {
      'x-forwarded-for': 'not-an-ip',
      'cf-connecting-ip': 'also-invalid',
      'x-real-ip': 'still-invalid',
    };
    expect((await app.request('/repair', { method: 'POST', headers })).status).toBe(200);
    expect((await app.request('/repair', { method: 'POST', headers })).status).toBe(429);
  });

  it('keeps client tracking bounded by evicting the oldest bucket', async () => {
    let address = '10.0.0.1';
    const { app, protection } = guardedApp({
      config: { maxRequests: 1, maxBuckets: 100 },
      remoteAddress: () => address,
    });

    for (let client = 1; client <= 101; client += 1) {
      address = `10.0.0.${client}`;
      expect((await app.request('/convert', { method: 'POST' })).status).toBe(200);
    }
    expect(protection.snapshot()).toMatchObject({ trackedClients: 100, accepted: 101 });

    address = '10.0.0.1';
    expect((await app.request('/convert', { method: 'POST' })).status).toBe(200);
    expect(protection.snapshot()).toMatchObject({ trackedClients: 100, accepted: 102 });
  });
});

describe('conversion ingress concurrency', () => {
  it('rejects excess work and releases the slot when work completes', async () => {
    let signalStarted!: () => void;
    let releaseWork!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const release = new Promise<void>((resolve) => (releaseWork = resolve));
    let address = '192.0.2.40';
    const { app, protection } = guardedApp(
      {
        config: { maxConcurrent: 1, maxRequests: 100, busyRetrySeconds: 7 },
        remoteAddress: () => address,
      },
      async () => {
        signalStarted();
        await release;
        return new Response('done');
      },
    );

    const first = app.request('/convert', { method: 'POST' });
    await started;
    address = '192.0.2.41';
    const busy = await app.request('/convert', { method: 'POST' });
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('7');
    expect(busy.headers.get('x-filemint-concurrency-limit')).toBe('1');
    expect(protection.snapshot()).toMatchObject({ active: 1, concurrencyRejections: 1 });

    releaseWork();
    expect((await first).status).toBe(200);
    expect(protection.snapshot().active).toBe(0);
  });

  it('releases the slot when a downstream route throws', async () => {
    const { app, protection } = guardedApp(
      { config: { maxConcurrent: 1 }, remoteAddress: () => '192.0.2.50' },
      (attempt) => {
        if (attempt === 1) throw new Error('conversion failed');
        return new Response('recovered');
      },
    );

    expect((await app.request('/convert', { method: 'POST' })).status).toBe(500);
    expect(protection.snapshot().active).toBe(0);
    expect((await app.request('/convert', { method: 'POST' })).status).toBe(200);
  });

  it('publishes active and rejection metrics', async () => {
    const { app, protection } = guardedApp({
      config: { maxRequests: 1 },
      remoteAddress: () => '192.0.2.60',
    });
    await app.request('/pdf/text', { method: 'POST' });
    await app.request('/pdf/text', { method: 'POST' });

    expect(protection.toPrometheus()).toContain('filemint_conversion_active 0');
    expect(protection.toPrometheus()).toContain('filemint_conversion_rate_limit_rejections_total 1');
  });
});

describe('conversion ingress route selection', () => {
  it.each([
    '/convert',
    '/edit/redact',
    '/edit/upload',
    '/image/normalize',
    '/ocr',
    '/pdf/render',
    '/pdf/text',
    '/repair',
    '/secure/lock',
    '/secure/permissions',
    '/secure/unlock',
  ])('protects POST %s', async (path) => {
    const { app } = guardedApp({ remoteAddress: () => '192.0.2.70' });
    const response = await app.request(path, { method: 'POST' });
    expect(response.headers.get('x-ratelimit-limit')).toBe('30');
  });

  it('does not throttle reads or unrelated POST routes', async () => {
    const { app } = guardedApp({
      config: { maxRequests: 1 },
      remoteAddress: () => '192.0.2.80',
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await app.request('/convert')).status).toBe(200);
      expect((await app.request('/auth/login', { method: 'POST' })).status).toBe(200);
    }
  });
});
