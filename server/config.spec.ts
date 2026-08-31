import { describe, expect, it } from 'vitest';
import {
  allowedOrigins,
  cleanServiceUrl,
  positiveInteger,
  resolveCorsOrigin,
  sanitizeRequestPath,
} from './config';

describe('server configuration', () => {
  it('normalizes service discovery URLs', () => {
    expect(cleanServiceUrl('"https://office.example.com/hosting/discovery?stale=1"', 'fallback')).toBe(
      'https://office.example.com',
    );
    expect(cleanServiceUrl('', 'http://localhost:9980/')).toBe('http://localhost:9980');
  });

  it('builds a deduplicated origin allowlist', () => {
    expect(
      allowedOrigins({
        NODE_ENV: 'production',
        CORS_ORIGINS: 'https://app.example.com/, https://admin.example.com',
        FILEMINT_PUBLIC_URL: 'https://app.example.com',
      }),
    ).toEqual(['https://app.example.com', 'https://admin.example.com', 'https://file-mint.vercel.app']);
  });

  it('accepts only explicitly allowed browser origins', () => {
    const origins = ['https://filemint.example.com'];
    expect(resolveCorsOrigin('https://filemint.example.com/', origins)).toBe('https://filemint.example.com');
    expect(resolveCorsOrigin('https://attacker.example.com', origins)).toBe('');
  });

  it('removes query strings and fragments from logged paths', () => {
    expect(sanitizeRequestPath('/auth/verify?token=secret#step')).toBe('/auth/verify');
    expect(sanitizeRequestPath('')).toBe('/');
  });

  it('uses safe numeric fallbacks', () => {
    expect(positiveInteger('4096', 100)).toBe(4096);
    expect(positiveInteger('-1', 100)).toBe(100);
    expect(positiveInteger('not-a-number', 100)).toBe(100);
  });
});
