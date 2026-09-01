import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { allowedOrigins, MAX_UPLOAD_BYTES, resolveCorsOrigin, sanitizeRequestPath } from './config';
import { createConversionIngressProtection } from './ingress-protection';
import { requestMetrics } from './metrics';
import { logger, reportException } from './observability';

export function registerCoreMiddleware(app: Hono): void {
  const origins = allowedOrigins();
  const conversionIngress = createConversionIngressProtection();

  app.use(
    '*',
    secureHeaders({
      crossOriginResourcePolicy: 'cross-origin',
      xFrameOptions: 'DENY',
    }),
  );
  app.use(
    '*',
    cors({
      origin: (origin) => resolveCorsOrigin(origin, origins),
      allowHeaders: ['Authorization', 'Content-Type', 'Stripe-Signature', 'X-WOPI-Override'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      exposeHeaders: [
        'Content-Disposition',
        'Content-Length',
        'Retry-After',
        'X-FileMint-Concurrency-Limit',
        'X-FileMint-Report',
        'X-RateLimit-Limit',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
      ],
      maxAge: 600,
    }),
  );
  app.use('*', async (c, next) => {
    const startedAt = performance.now();
    const requestId = c.req.header('x-request-id')?.slice(0, 100) || randomUUID();
    const path = sanitizeRequestPath(c.req.url);
    c.header('X-Request-Id', requestId);

    try {
      await next();
    } finally {
      const durationMs = performance.now() - startedAt;
      requestMetrics.observe(c.res.status, durationMs);
      if (path !== '/health' && path !== '/metrics') {
        logger.info(
          { method: c.req.method, path, status: c.res.status, durationMs, requestId },
          'request completed',
        );
      }
    }
  });
  app.use('*', conversionIngress.middleware);
  app.use(
    '*',
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES,
      onError: (c) => c.json({ error: 'The upload exceeds the configured size limit.' }, 413),
    }),
  );

  app.get('/metrics', (c) =>
    c.text(`${requestMetrics.toPrometheus()}${conversionIngress.toPrometheus()}`, 200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    }),
  );

  app.onError((error, c) => {
    const requestId = c.res.headers.get('X-Request-Id') ?? undefined;
    const path = sanitizeRequestPath(c.req.url);
    reportException(error, { method: c.req.method, path, requestId });
    logger.error({ err: error, method: c.req.method, path, requestId }, 'request failed');
    return c.json({ error: 'Internal server error.' }, 500);
  });
}
