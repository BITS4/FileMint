import { describe, expect, it } from 'vitest';
import { imageMime, sniffImageType } from './image-sniff';

const ascii = (value: string) => new TextEncoder().encode(value);

describe('image signature detection', () => {
  it.each([
    [Uint8Array.from([0xff, 0xd8, 0xff]), 'jpg'],
    [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'png'],
    [ascii('GIF89a'), 'gif'],
    [ascii('BM'), 'bmp'],
    [ascii('RIFF0000WEBP'), 'webp'],
    [ascii('<svg viewBox="0 0 1 1"></svg>'), 'svg'],
  ])('recognizes %s', (bytes, expected) => {
    expect(sniffImageType(bytes as Uint8Array)).toBe(expected);
  });

  it('recognizes ISO media brands and unknown data', () => {
    expect(sniffImageType(Uint8Array.from([...ascii('0000ftypavif')]))).toBe('avif');
    expect(sniffImageType(Uint8Array.from([...ascii('0000ftypheic')]))).toBe('heic');
    expect(sniffImageType(Uint8Array.from([1, 2, 3]))).toBe('unknown');
  });

  it('maps detected and extension-only types to MIME values', () => {
    expect(imageMime('jpg')).toBe('image/jpeg');
    expect(imageMime('unknown', '.tif')).toBe('image/tiff');
    expect(imageMime('unknown', 'svgz')).toBe('image/svg+xml');
    expect(imageMime('unknown', 'bin')).toBe('application/octet-stream');
  });
});
