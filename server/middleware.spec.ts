import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCoreMiddleware } from './middleware';

const observabilityMocks = vi.hoisted(() => ({
  logger: { error: vi.fn(), info: vi.fn() },
  reportException: vi.fn(),
}));

vi.mock('./observability', () => observabilityMocks);

const routeFailure = new Error('private failure detail');

function testApp() {
  const app = new Hono();
  registerCoreMiddleware(app);
  app.get('/ok', (c) => c.json({ ok: true }));
  app.get('/failure', () => {
    throw routeFailure;
  });
  app.post('/upload', async (c) => c.text(await c.req.text()));
  return app;
}

describe('core server middleware', () => {
  beforeEach(() => {
    observabilityMocks.logger.error.mockClear();
    observabilityMocks.logger.info.mockClear();
    observabilityMocks.reportException.mockClear();
  });

  it('adds security headers and permits the configured frontend', async () => {
    const response = await testApp().request('/ok', {
      headers: { Origin: 'https://file-mint.vercel.app' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://file-mint.vercel.app');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('does not grant CORS access to unknown origins', async () => {
    const response = await testApp().request('/ok', {
      headers: { Origin: 'https://attacker.example.com' },
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns a generic response for unhandled failures', async () => {
    const response = await testApp().request('/failure');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error.' });
    expect(observabilityMocks.reportException).toHaveBeenCalledWith(
      routeFailure,
      expect.objectContaining({ method: 'GET', path: '/failure' }),
    );
    expect(observabilityMocks.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: routeFailure, method: 'GET', path: '/failure' }),
      'request failed',
    );
    expect(observabilityMocks.logger.error.mock.calls[0][0]).not.toHaveProperty('error');
  });

  it('rejects requests that advertise an oversized body', async () => {
    const response = await testApp().request('/upload', {
      method: 'POST',
      headers: { 'Content-Length': String(76 * 1024 * 1024) },
      body: 'x',
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'The upload exceeds the configured size limit.' });
  });

  it('exposes Prometheus metrics', async () => {
    const response = await testApp().request('/metrics');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('filemint_http_requests_total');
  });
});
