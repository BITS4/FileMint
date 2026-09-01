import { describe, expect, it } from 'vitest';
import { buildReport, parseDelimitedRows } from './model';

describe('convert-to-PDF report and delimited text model', () => {
  it('delegates standard CSV parsing for empty and comma delimiters', () => {
    expect(parseDelimitedRows('name,note\n"FileMint","a,b"', ',')).toEqual([
      ['name', 'note'],
      ['FileMint', 'a,b'],
    ]);
    expect(parseDelimitedRows('a,b', '')).toEqual([['a', 'b']]);
  });

  it('normalizes newlines and removes blank custom-delimiter rows', () => {
    expect(parseDelimitedRows('a|b\r\n | \r\n1|2', '|')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('builds a singular no-crop preflight report while preserving source details', () => {
    const report = buildReport(1, 0, 0, 0, {
      warnings: ['Source warning'],
      ocrLanguage: 'eng',
      engine: 'source engine',
    });

    expect(report).toMatchObject({
      engine: 'FileMint PDF Studio',
      resolvedMode: 'convert-to-pdf-preflight',
      pagesConverted: 1,
      visualObjectsPreserved: 1,
      ocrLanguage: 'eng',
      notes: ['1 page exported after preview.', 'No page crops applied.'],
      warnings: ['Source warning'],
    });
  });

  it('documents filtered, rectangular, and free-shape page behavior', () => {
    const report = buildReport(3, 2, 1, 1);

    expect(report.notes).toEqual([
      '3 pages exported after preview.',
      '1 cropped page exported; rectangular crops use PDF crop boxes, free crops use a raster crop.',
    ]);
    expect(report.warnings).toEqual([
      'Filtered pages are rasterized because visual filters change page pixels.',
      'Free-shape cropped pages are rasterized so the exported PDF follows the visible quadrilateral crop.',
    ]);
  });

  it('uses plural crop wording when multiple pages are cropped', () => {
    expect(buildReport(2, 0, 2, 0).notes?.[1]).toContain('2 cropped pages exported');
  });
});
