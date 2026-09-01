import { isIP } from 'node:net';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';

import type { Environment } from './config';

const HEAVY_POST_PATHS = new Set([
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
]);

export interface ConversionIngressConfig {
  maxRequests: number;
  windowMs: number;
  maxConcurrent: number;
  busyRetrySeconds: number;
  maxBuckets: number;
  trustProxy: boolean;
}

export interface ConversionIngressSnapshot {
  active: number;
  trackedClients: number;
  accepted: number;
  rateLimitRejections: number;
  concurrencyRejections: number;
}

export interface ConversionIngressProtection {
  middleware: MiddlewareHandler;
  snapshot(): ConversionIngressSnapshot;
  toPrometheus(): string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

interface IngressOptions {
  config?: Partial<ConversionIngressConfig>;
  now?: () => number;
  remoteAddress?: (context: Context) => string | undefined;
}

const DEFAULT_CONFIG: ConversionIngressConfig = {
  maxRequests: 30,
  windowMs: 60_000,
  maxConcurrent: 2,
  busyRetrySeconds: 5,
  maxBuckets: 5_000,
  trustProxy: false,
};

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function readConversionIngressConfig(env: Environment = process.env): ConversionIngressConfig {
  return {
    maxRequests: boundedInteger(env.FILEMINT_CONVERSION_RATE_LIMIT, DEFAULT_CONFIG.maxRequests, 1, 1_000),
    windowMs: boundedInteger(
      env.FILEMINT_CONVERSION_RATE_WINDOW_MS,
      DEFAULT_CONFIG.windowMs,
      1_000,
      3_600_000,
    ),
    maxConcurrent: boundedInteger(
      env.FILEMINT_CONVERSION_MAX_CONCURRENT,
      DEFAULT_CONFIG.maxConcurrent,
      1,
      64,
    ),
    busyRetrySeconds: boundedInteger(
      env.FILEMINT_CONVERSION_BUSY_RETRY_SECONDS,
      DEFAULT_CONFIG.busyRetrySeconds,
      1,
      300,
    ),
    maxBuckets: boundedInteger(env.FILEMINT_CONVERSION_RATE_BUCKETS, DEFAULT_CONFIG.maxBuckets, 100, 100_000),
    trustProxy: env.FILEMINT_TRUST_PROXY === 'true',
  };
}

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null;
  const candidate = value.trim().replace(/^\[|\]$/g, '');
  return candidate.length <= 64 && isIP(candidate) ? candidate.toLowerCase() : null;
}

function nodeRemoteAddress(context: Context): string | undefined {
  try {
    return getConnInfo(context).remote.address;
  } catch {
    // Hono's in-memory test adapter has no socket. Sharing one fallback bucket
    // is safer than accepting a spoofable request header.
    return undefined;
  }
}

export function resolveConversionClient(
  context: Context,
  trustProxy: boolean,
  remoteAddress: (context: Context) => string | undefined = nodeRemoteAddress,
): string {
  const direct = normalizeIp(remoteAddress(context)) ?? 'unknown';
  if (!trustProxy) return direct;

  const forwarded = context.req.header('x-forwarded-for')?.split(',', 1)[0];
  return (
    normalizeIp(forwarded) ??
    normalizeIp(context.req.header('cf-connecting-ip')) ??
    normalizeIp(context.req.header('x-real-ip')) ??
    direct
  );
}

function withOverrides(overrides: Partial<ConversionIngressConfig> | undefined): ConversionIngressConfig {
  const base = readConversionIngressConfig();
  if (!overrides) return base;
  return {
    maxRequests: boundedInteger(overrides.maxRequests, base.maxRequests, 1, 1_000),
    windowMs: boundedInteger(overrides.windowMs, base.windowMs, 1_000, 3_600_000),
    maxConcurrent: boundedInteger(overrides.maxConcurrent, base.maxConcurrent, 1, 64),
    busyRetrySeconds: boundedInteger(overrides.busyRetrySeconds, base.busyRetrySeconds, 1, 300),
    maxBuckets: boundedInteger(overrides.maxBuckets, base.maxBuckets, 100, 100_000),
    trustProxy: overrides.trustProxy ?? base.trustProxy,
  };
}

function rateHeaders(context: Context, config: ConversionIngressConfig, bucket: RateBucket): void {
  context.header('X-RateLimit-Limit', String(config.maxRequests));
  context.header('X-RateLimit-Remaining', String(Math.max(0, config.maxRequests - bucket.count)));
  context.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1_000)));
}

export function createConversionIngressProtection(options: IngressOptions = {}): ConversionIngressProtection {
  const config = withOverrides(options.config);
  const now = options.now ?? Date.now;
  const remoteAddress = options.remoteAddress ?? nodeRemoteAddress;
  const buckets = new Map<string, RateBucket>();
  let lastPruneAt = 0;
  let active = 0;
  let accepted = 0;
  let rateLimitRejections = 0;
  let concurrencyRejections = 0;

  const pruneBuckets = (time: number) => {
    if (time - lastPruneAt >= config.windowMs || buckets.size >= config.maxBuckets) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= time) buckets.delete(key);
      }
      lastPruneAt = time;
    }
    while (buckets.size >= config.maxBuckets) {
      const oldest = buckets.keys().next().value as string | undefined;
      if (!oldest) break;
      buckets.delete(oldest);
    }
  };

  const consumeRate = (client: string, time: number): RateBucket => {
    const current = buckets.get(client);
    if (!current || current.resetAt <= time) {
      pruneBuckets(time);
      const bucket = { count: 1, resetAt: time + config.windowMs };
      buckets.set(client, bucket);
      return bucket;
    }
    current.count = Math.min(config.maxRequests + 1, current.count + 1);
    return current;
  };

  const middleware: MiddlewareHandler = async (context, next) => {
    if (context.req.method !== 'POST' || !HEAVY_POST_PATHS.has(context.req.path)) {
      await next();
      return;
    }

    const time = now();
    const client = resolveConversionClient(context, config.trustProxy, remoteAddress);
    const bucket = consumeRate(client, time);
    rateHeaders(context, config, bucket);
    context.header('X-FileMint-Concurrency-Limit', String(config.maxConcurrent));

    if (bucket.count > config.maxRequests) {
      rateLimitRejections += 1;
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - time) / 1_000));
      context.header('Retry-After', String(retryAfter));
      return context.json(
        { error: 'Too many conversion requests. Try again after the rate-limit window resets.' },
        429,
      );
    }

    if (active >= config.maxConcurrent) {
      concurrencyRejections += 1;
      context.header('Retry-After', String(config.busyRetrySeconds));
      return context.json({ error: 'The conversion service is busy. Try again shortly.' }, 429);
    }

    active += 1;
    accepted += 1;
    try {
      await next();
    } finally {
      active = Math.max(0, active - 1);
    }
  };

  const snapshot = (): ConversionIngressSnapshot => ({
    active,
    trackedClients: buckets.size,
    accepted,
    rateLimitRejections,
    concurrencyRejections,
  });

  return {
    middleware,
    snapshot,
    toPrometheus: () => {
      const state = snapshot();
      return [
        '# HELP filemint_conversion_active Active heavyweight conversion requests.',
        '# TYPE filemint_conversion_active gauge',
        `filemint_conversion_active ${state.active}`,
        '# HELP filemint_conversion_rate_limit_rejections_total Conversion requests rejected by client rate limits.',
        '# TYPE filemint_conversion_rate_limit_rejections_total counter',
        `filemint_conversion_rate_limit_rejections_total ${state.rateLimitRejections}`,
        '# HELP filemint_conversion_concurrency_rejections_total Conversion requests rejected while all worker slots were occupied.',
        '# TYPE filemint_conversion_concurrency_rejections_total counter',
        `filemint_conversion_concurrency_rejections_total ${state.concurrencyRejections}`,
        '',
      ].join('\n');
    },
  };
}
