export type Environment = Record<string, string | undefined>;

const LOCAL_ORIGINS = ['http://localhost:8081', 'http://127.0.0.1:8081'];
const DEFAULT_PUBLIC_ORIGIN = 'https://file-mint.vercel.app';

function isProduction(env: Environment): boolean {
  return env.NODE_ENV === 'production' || env.FILEMINT_PRODUCTION === 'true';
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function cleanServiceUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? fallback)
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();
  const candidate = raw || fallback;

  try {
    const url = new URL(candidate);
    url.pathname = url.pathname.replace(/\/hosting\/discovery\/?$/i, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return candidate.replace(/\/+$/, '');
  }
}

export function allowedOrigins(env: Environment = process.env): string[] {
  const configured = [
    ...(env.CORS_ORIGINS ?? '').split(','),
    env.FILEMINT_PUBLIC_URL,
    env.PUBLIC_APP_URL,
    env.APP_URL,
  ]
    .map((value) => value?.trim().replace(/\/+$/, ''))
    .filter((value): value is string => Boolean(value));

  const defaults = isProduction(env) ? [DEFAULT_PUBLIC_ORIGIN] : [...LOCAL_ORIGINS, DEFAULT_PUBLIC_ORIGIN];
  return [...new Set([...configured, ...defaults])];
}

export function resolveCorsOrigin(origin: string, origins: readonly string[]): string {
  const normalized = origin.trim().replace(/\/+$/, '');
  return origins.includes(normalized) ? normalized : '';
}

export function sanitizeRequestPath(value: string): string {
  try {
    return new URL(value, 'http://filemint.local').pathname || '/';
  } catch {
    return value.split(/[?#]/, 1)[0] || '/';
  }
}

export const PORT = positiveInteger(process.env.PORT, 8787);
export const VERSION = '1.0.0';
export const MAX_UPLOAD_BYTES = positiveInteger(process.env.FILEMINT_MAX_UPLOAD_BYTES, 75 * 1024 * 1024);
export const COLLABORA_URL = cleanServiceUrl(process.env.COLLABORA_URL, 'http://localhost:9980');
export const WOPI_HOST = cleanServiceUrl(process.env.WOPI_HOST, `http://host.docker.internal:${PORT}`);
