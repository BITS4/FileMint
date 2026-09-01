import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUAD,
  clamp01,
  cloneBytes,
  cropIsActive,
  formatPercent,
  isPdfBytes,
  mapFilter,
  marginPoints,
  orientationForPage,
  orientationForPdf,
  outputPageBoxForRaster,
  pageAspectRatio,
  pageSizeForPdf,
  parseNumber,
  pngSize,
  quadIsAxisAligned,
  quadIsDefault,
  type CropQuad,
  type StudioPage,
} from './model';

const page = (overrides: Partial<StudioPage> = {}) =>
  ({
    pageWidthPt: 600,
    pageHeightPt: 800,
    previewWidth: 300,
    previewHeight: 400,
    ...overrides,
  }) as StudioPage;

describe('convert-to-PDF page layout model', () => {
  it('covers every margin size and orientation choice', () => {
    expect(['none', 'small', 'medium', 'large'].map((margin) => marginPoints(margin as never))).toEqual([
      0, 24, 42, 64,
    ]);
    expect(pageSizeForPdf('auto')).toBe('fit');
    expect(pageSizeForPdf('letter')).toBe('letter');
    expect(orientationForPdf('landscape')).toBe('landscape');
    expect(orientationForPdf('auto')).toBe('portrait');
    expect(orientationForPage('portrait', 900, 600)).toBe('portrait');
    expect(orientationForPage('landscape', 600, 900)).toBe('landscape');
    expect(orientationForPage('auto', 900, 600)).toBe('landscape');
    expect(orientationForPage('auto', 600, 900)).toBe('portrait');
  });

  it('preserves raster dimensions in auto mode and applies fixed page margins', () => {
    expect(outputPageBoxForRaster({ width: 320, height: 240 }, 'auto', 'landscape', 'large')).toEqual({
      width: 320,
      height: 240,
      margin: 0,
    });
    expect(outputPageBoxForRaster({ width: 320, height: 640 }, 'letter', 'portrait', 'medium')).toEqual({
      width: 612,
      height: 792,
      margin: 42,
    });
  });

  it('uses PDF dimensions when valid and preview dimensions otherwise', () => {
    expect(pageAspectRatio(page())).toBe(0.75);
    expect(pageAspectRatio(page({ pageWidthPt: Number.NaN, pageHeightPt: 0 }))).toBe(0.75);
    expect(pageAspectRatio(page({ pageWidthPt: 0.01, pageHeightPt: 1000 }))).toBe(0.12);
    expect(pageAspectRatio(page({ pageWidthPt: 100, pageHeightPt: Number.POSITIVE_INFINITY }))).toBe(0.25);
  });

  it('clamps numbers, formats percentages, and clones byte buffers independently', () => {
    expect([clamp01(-2), clamp01(0.4), clamp01(3)]).toEqual([0, 0.4, 1]);
    expect(parseNumber('12.5', 9)).toBe(12.5);
    expect(parseNumber('Infinity', 9)).toBe(9);
    expect(formatPercent(1.234)).toBe('1.2');
    const source = new Uint8Array([1, 2]);
    const copy = cloneBytes(source);
    copy[0] = 9;
    expect(source).toEqual(new Uint8Array([1, 2]));
  });

  it('detects every crop activation edge and quad alignment tolerance', () => {
    expect(cropIsActive({ top: 0, right: 0, bottom: 0, left: 0 })).toBe(false);
    expect(cropIsActive({ top: 1, right: 0, bottom: 0, left: 0 })).toBe(true);
    expect(cropIsActive({ top: 0, right: 1, bottom: 0, left: 0 })).toBe(true);
    expect(cropIsActive({ top: 0, right: 0, bottom: 1, left: 0 })).toBe(true);
    expect(cropIsActive({ top: 0, right: 0, bottom: 0, left: 1 })).toBe(true);

    const closeToDefault: CropQuad = {
      ...DEFAULT_QUAD,
      tl: { x: 0.002, y: 0.002 },
    };
    expect(quadIsDefault(closeToDefault)).toBe(true);
    expect(quadIsDefault({ ...closeToDefault, tl: { x: 0.004, y: 0 } })).toBe(false);
    expect(quadIsAxisAligned(DEFAULT_QUAD)).toBe(true);
    expect(quadIsAxisAligned({ ...DEFAULT_QUAD, tr: { x: 1, y: 0.01 } })).toBe(false);
    expect(quadIsAxisAligned({ ...DEFAULT_QUAD, br: { x: 0.98, y: 1 } })).toBe(false);
  });

  it('validates complete PNG dimensions and each PDF signature boundary', () => {
    const badWidth = new Uint8Array(25);
    badWidth.set([0x89, 0x50, 0x4e, 0x47]);
    badWidth.set([0, 0, 0, 2], 20);
    expect(pngSize(badWidth)).toEqual({ width: 1, height: 1.414 });
    expect(pngSize(new Uint8Array(25))).toEqual({ width: 1, height: 1.414 });

    expect(isPdfBytes(new TextEncoder().encode('%PDF-'))).toBe(true);
    expect(isPdfBytes(new TextEncoder().encode('%PDF'))).toBe(false);
    for (const value of ['XPDF-', '%XDF-', '%PXF-', '%PDX-', '%PDFX']) {
      expect(isPdfBytes(new TextEncoder().encode(value))).toBe(false);
    }
  });

  it('maps every visual filter family to the native image filter model', () => {
    expect(mapFilter('original')).toBe('none');
    expect(mapFilter('grayscale')).toBe('grayscale');
    expect(mapFilter('light-text')).toBe('grayscale');
    expect(mapFilter('bw')).toBe('bw');
    expect(mapFilter('whiteboard')).toBe('bw');
    expect(mapFilter('auto-enhance')).toBe('contrast');
  });
});
