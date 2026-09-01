import { describe, expect, it } from 'vitest';

import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from './legal';

describe('legal document links', () => {
  it.each([PRIVACY_POLICY_URL, TERMS_OF_USE_URL])('uses a repository-owned HTTPS document: %s', (url) => {
    expect(url).toMatch(/^https:\/\/github\.com\/BITS4\/FileMint\/blob\/main\//);
    expect(url).not.toContain('example.com');
  });
});
