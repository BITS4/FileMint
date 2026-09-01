import { describe, expect, it } from 'vitest';

import { CAPABILITIES, resolveBinary } from './runtime';

describe('conversion runtime discovery', () => {
  it('accepts an existing explicit executable and rejects missing paths', () => {
    expect(resolveBinary([process.execPath], ['--version'])).toBe(process.execPath);
    expect(resolveBinary(['Z:\\missing-filemint-engine.exe'], ['--version'])).toBeNull();
  });

  it('publishes boolean capability flags for every conversion surface', () => {
    expect(Object.keys(CAPABILITIES).sort()).toEqual(
      [
        'ghostscript',
        'imageNormalize',
        'libreoffice',
        'ocr',
        'pdf2docx',
        'pdfEdit',
        'pdfExport',
        'pdfRepair',
        'pdfUtility',
        'qpdf',
      ].sort(),
    );
    expect(Object.values(CAPABILITIES).every((value) => typeof value === 'boolean')).toBe(true);
  });
});
