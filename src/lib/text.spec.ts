import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeUtf8, encodeUtf8, formatCsvAsText, parseCsvRows } from './text';

describe('text helpers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips multilingual UTF-8 text', () => {
    const text = 'FileMint — Тоҷикистон — 😀';
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });

  it('supports runtimes without TextEncoder and TextDecoder', () => {
    vi.stubGlobal('TextEncoder', undefined);
    vi.stubGlobal('TextDecoder', undefined);
    const text = 'Résumé 😀';
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
  });

  it('parses quoted CSV cells, escaped quotes, and line endings', () => {
    expect(parseCsvRows('name,note\r\n"FileMint","said ""hello"""\r\n')).toEqual([
      ['name', 'note'],
      ['FileMint', 'said "hello"'],
    ]);
  });

  it('aligns CSV columns for PDF text output', () => {
    const result = formatCsvAsText('name,count\nPDF,2\nDocument,10');
    expect(result.split('\n')).toHaveLength(3);
    expect(result).toContain('Document');
    expect(formatCsvAsText('\n')).toBe('');
  });
});
