import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, dataUrl } from './base64';

describe('base64 helpers', () => {
  it.each([
    { values: [] as number[] },
    { values: [0] },
    { values: [0, 255] },
    { values: [1, 2, 3] },
    { values: [70, 105, 108, 101, 77, 105, 110, 116] },
  ])('round-trips byte arrays %#', ({ values }) => {
    const input = Uint8Array.from(values);
    expect(base64ToBytes(bytesToBase64(input))).toEqual(input);
  });

  it('ignores whitespace in incoming base64', () => {
    expect(base64ToBytes('Rmls\nZU1pbnQ=')).toEqual(Uint8Array.from([70, 105, 108, 101, 77, 105, 110, 116]));
  });

  it('creates a typed data URL', () => {
    expect(dataUrl('text/plain', Uint8Array.from([72, 105]))).toBe('data:text/plain;base64,SGk=');
  });
});
