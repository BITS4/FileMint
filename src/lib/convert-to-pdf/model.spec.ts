import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUAD,
  assertPdfBytes,
  clampPercent,
  cloneQuad,
  cropFromQuad,
  cropIsActive,
  mapFilter,
  marginPoints,
  normalizeProfile,
  outputPageBoxForRaster,
  parseDelimitedRows,
  pngSize,
  profileTitle,
  quadFromCrop,
  quadIsAxisAligned,
  quadIsDefault,
  supportsProfile,
} from './model';
import type { FileItem } from '@/types';

const file = (kind: FileItem['kind'], ext: string) => ({ kind, ext }) as FileItem;

describe('convert-to-PDF studio model', () => {
  it('normalizes route profiles and display titles', () => {
    expect(normalizeProfile(['image'])).toBe('image');
    expect(normalizeProfile('unknown')).toBe('all');
    expect(profileTitle('ppt')).toBe('PowerPoint to PDF');
    expect(profileTitle('all')).toBe('Convert to PDF');
  });

  it('accepts files only when they match the selected profile', () => {
    expect(supportsProfile(file('image', 'png'), 'image')).toBe(true);
    expect(supportsProfile(file('word', 'docx'), 'word')).toBe(true);
    expect(supportsProfile(file('text', 'md'), 'csv')).toBe(false);
    expect(supportsProfile(file('image', 'exe'), 'all')).toBe(false);
  });

  it('converts between rectangular crop values and crop quads', () => {
    const crop = { top: 10, right: 20, bottom: 30, left: 40 };
    const quad = quadFromCrop(crop);

    const result = cropFromQuad(quad);
    expect(result.top).toBeCloseTo(crop.top);
    expect(result.right).toBeCloseTo(crop.right);
    expect(result.bottom).toBeCloseTo(crop.bottom);
    expect(result.left).toBeCloseTo(crop.left);
    expect(quadIsAxisAligned(quad)).toBe(true);
    expect(quadIsDefault(DEFAULT_QUAD)).toBe(true);
    expect(cropIsActive(crop)).toBe(true);
  });

  it('clones crop points without sharing nested objects', () => {
    const copy = cloneQuad(DEFAULT_QUAD);
    copy.tl.x = 0.5;

    expect(DEFAULT_QUAD.tl.x).toBe(0);
    expect(quadIsDefault(copy)).toBe(false);
  });

  it('reads PNG dimensions with a safe fallback', () => {
    const header = new Uint8Array(25);
    header.set([0x89, 0x50, 0x4e, 0x47], 0);
    header.set([0, 0, 2, 0], 16);
    header.set([0, 0, 1, 0], 20);

    expect(pngSize(header)).toEqual({ width: 512, height: 256 });
    expect(pngSize(Uint8Array.of(1, 2))).toEqual({ width: 1, height: 1.414 });
  });

  it('validates PDF signatures with actionable errors', () => {
    expect(() => assertPdfBytes(new TextEncoder().encode('%PDF-1.7'), 'Preview')).not.toThrow();
    expect(() => assertPdfBytes(Uint8Array.of(1, 2), 'Preview')).toThrow(
      /Preview did not produce a valid PDF/,
    );
  });

  it('maps filters, margins, and bounded percentages', () => {
    expect(mapFilter('original')).toBe('none');
    expect(mapFilter('light-text')).toBe('grayscale');
    expect(mapFilter('whiteboard')).toBe('bw');
    expect(marginPoints('large')).toBe(64);
    expect(clampPercent('101')).toBe(80);
    expect(clampPercent('invalid')).toBe(0);
  });

  it('computes output page boxes and parses custom delimiters', () => {
    expect(outputPageBoxForRaster({ width: 900, height: 600 }, 'a4', 'auto', 'small')).toEqual({
      width: 841.89,
      height: 595.28,
      margin: 24,
    });
    expect(parseDelimitedRows('a;b\n1;2', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseDelimitedRows('a\tb', 'tab')).toEqual([['a', 'b']]);
  });
});
