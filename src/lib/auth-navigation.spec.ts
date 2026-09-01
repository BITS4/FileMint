import { describe, expect, it } from 'vitest';

import { buildAuthRoute, isSafeInternalRoute, safeInternalRedirect } from './auth-navigation';

describe('internal redirect validation', () => {
  it.each([
    '/',
    '/files',
    '/viewer/file-1?night=true',
    '/upgrade?redirect=%2Ftool%2Fcompress#plans',
    '/folder/%E2%9C%93',
  ])('accepts internal application route %s', (route) => {
    expect(isSafeInternalRoute(route)).toBe(true);
    expect(safeInternalRedirect(route)).toBe(route);
  });

  it.each([
    'https://attacker.example',
    'javascript:alert(1)',
    '//attacker.example/path',
    '/\\attacker.example',
    '/%2f%2fattacker.example',
    '/folder/../admin',
    '/folder/%2e%2e/admin',
    '/line\nbreak',
    '/bad%escape',
    '',
  ])('rejects unsafe redirect %j', (route) => {
    expect(safeInternalRedirect(route)).toBe('/');
  });

  it('normalizes array parameters and protects an invalid fallback', () => {
    expect(safeInternalRedirect(['/files', 'https://attacker.example'])).toBe('/files');
    expect(safeInternalRedirect(undefined, 'https://attacker.example')).toBe('/');
  });
});

describe('authentication route construction', () => {
  it('encodes email and a validated redirect without changing their meaning', () => {
    const route = buildAuthRoute('/auth/verify', {
      email: 'reader+mobile@example.com',
      redirect: '/tool/pdf-to-word?mode=ocr',
    });
    const url = new URL(route, 'https://filemint.local');

    expect(url.pathname).toBe('/auth/verify');
    expect(url.searchParams.get('email')).toBe('reader+mobile@example.com');
    expect(url.searchParams.get('redirect')).toBe('/tool/pdf-to-word?mode=ocr');
  });

  it('replaces an external redirect with the safe application root', () => {
    const route = buildAuthRoute('/auth/login', { redirect: 'https://attacker.example' });
    expect(new URL(route, 'https://filemint.local').searchParams.get('redirect')).toBe('/');
  });
});
