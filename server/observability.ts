import * as Sentry from '@sentry/node';
import pino from 'pino';

const level = process.env.LOG_LEVEL?.trim() || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

export const logger = pino({
  level: process.env.VITEST ? 'silent' : level,
  base: { service: 'filemint-server' },
  redact: {
    paths: [
      'authorization',
      'cookie',
      'password',
      'token',
      'code',
      'stripeSignature',
      '*.authorization',
      '*.cookie',
      '*.password',
      '*.token',
      '*.code',
      '*.stripeSignature',
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',
      'body.code',
    ],
    censor: '[REDACTED]',
  },
});

const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0);

Sentry.init({
  dsn: process.env.SENTRY_DSN?.trim() || undefined,
  enabled: Boolean(process.env.SENTRY_DSN?.trim()),
  environment: process.env.NODE_ENV ?? 'development',
  tracesSampleRate:
    Number.isFinite(tracesSampleRate) && tracesSampleRate >= 0 && tracesSampleRate <= 1
      ? tracesSampleRate
      : 0,
});

export function reportException(
  error: unknown,
  context: { component?: string; method?: string; path?: string; requestId?: string } = {},
): void {
  Sentry.captureException(error, {
    tags: {
      component: context.component ?? 'http',
      method: context.method,
    },
    extra: {
      path: context.path,
      requestId: context.requestId,
    },
  });
}
