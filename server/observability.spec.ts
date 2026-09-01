import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  pino: vi.fn(),
}));

vi.mock('@sentry/node', () => ({
  captureException: mocks.captureException,
  init: mocks.init,
}));
vi.mock('pino', () => ({ default: mocks.pino }));

describe('server observability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.captureException.mockReset();
    mocks.init.mockReset();
    mocks.pino.mockReset().mockReturnValue(mocks.logger);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('configures production logging, redaction, and a valid Sentry sampling rate', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOG_LEVEL', 'warn');
    vi.stubEnv('SENTRY_DSN', ' https://public@example.ingest.sentry.io/1 ');
    vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '0.25');

    await import('./observability');

    expect(mocks.pino).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        base: { service: 'filemint-server' },
        redact: expect.objectContaining({ censor: '[REDACTED]' }),
      }),
    );
    const loggerOptions = mocks.pino.mock.calls[0][0] as { redact: { paths: string[] } };
    expect(loggerOptions.redact.paths).toEqual(
      expect.arrayContaining(['authorization', '*.password', '*.token', '*.stripeSignature']),
    );
    expect(mocks.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.ingest.sentry.io/1',
      enabled: true,
      environment: 'production',
      tracesSampleRate: 0.25,
    });
  });

  it('disables Sentry and clamps an invalid trace sample rate to zero', async () => {
    vi.stubEnv('VITEST', '');
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOG_LEVEL', '');
    vi.stubEnv('SENTRY_DSN', '');
    vi.stubEnv('SENTRY_TRACES_SAMPLE_RATE', '2');

    await import('./observability');

    expect(mocks.pino).toHaveBeenCalledWith(expect.objectContaining({ level: 'debug' }));
    expect(mocks.init).toHaveBeenCalledWith({
      dsn: undefined,
      enabled: false,
      environment: 'development',
      tracesSampleRate: 0,
    });
  });

  it('forwards an exception with safe HTTP context', async () => {
    const { reportException } = await import('./observability');
    const error = new Error('conversion failed');

    reportException(error, { method: 'POST', path: '/convert', requestId: 'req-7' });

    expect(mocks.captureException).toHaveBeenCalledWith(error, {
      tags: { component: 'http', method: 'POST' },
      extra: { path: '/convert', requestId: 'req-7' },
    });
  });
});
