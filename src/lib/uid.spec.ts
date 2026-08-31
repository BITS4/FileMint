import { afterEach, describe, expect, it, vi } from 'vitest';
import { uid } from './uid';

describe('uid', () => {
  afterEach(() => vi.restoreAllMocks());

  it('combines an optional prefix with time and random components', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(uid('doc_')).toBe('doc_rsi');
  });

  it('generates values without a required prefix', () => {
    expect(uid()).toMatch(/^[a-z0-9]+$/);
  });
});
