const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;

function firstString(value: unknown): string {
  if (Array.isArray(value)) return firstString(value[0]);
  return typeof value === 'string' ? value.trim() : '';
}

export function isSafeInternalRoute(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || CONTROL_OR_BACKSLASH.test(value)) return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }

  if (!decoded.startsWith('/') || decoded.startsWith('//') || CONTROL_OR_BACKSLASH.test(decoded))
    return false;
  const pathname = decoded.split(/[?#]/, 1)[0];
  return !pathname.split('/').includes('..');
}

export function safeInternalRedirect(value: unknown, fallback = '/'): string {
  const safeFallback = isSafeInternalRoute(fallback) ? fallback : '/';
  const candidate = firstString(value);
  return candidate && isSafeInternalRoute(candidate) ? candidate : safeFallback;
}

type AuthPath = '/auth/login' | '/auth/reset' | '/auth/signup' | '/auth/verify';

export function buildAuthRoute(path: AuthPath, options: { email?: string; redirect?: unknown } = {}): string {
  const params = new URLSearchParams();
  const email = options.email?.trim();
  if (email) params.set('email', email);
  if (options.redirect !== undefined) params.set('redirect', safeInternalRedirect(options.redirect));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}
