import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  baseName,
  extFromName,
  formatBytes,
  formatPages,
  formatRelativeDate,
  kindFromExt,
  kindFromMime,
  kindMeta,
  uniqueName,
  withExt,
} from './format';

describe('file formatting helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('formats byte and page counts', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(1_536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatPages()).toBe('');
    expect(formatPages(1)).toBe('1 page');
    expect(formatPages(3)).toBe('3 pages');
  });

  it('formats relative dates across useful boundaries', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));
    expect(formatRelativeDate(Date.now() - 10_000)).toBe('Just now');
    expect(formatRelativeDate(Date.now() - 5 * 60_000)).toBe('5m ago');
    expect(formatRelativeDate(Date.now() - 3 * 60 * 60_000)).toBe('3h ago');
    expect(formatRelativeDate(Date.now() - 24 * 60 * 60_000)).toBe('Yesterday');
    expect(formatRelativeDate(new Date('2025-03-12T12:00:00Z').getTime())).toContain('2025');
  });

  it('derives names, extensions, and unique copies', () => {
    expect(extFromName('report.FINAL.PDF')).toBe('pdf');
    expect(extFromName('README')).toBe('');
    expect(baseName('.env')).toBe('.env');
    expect(baseName('report.pdf')).toBe('report');
    expect(withExt('', 'pdf')).toBe('Untitled.pdf');
    expect(withExt('report.PDF', 'pdf')).toBe('report.PDF');
    expect(uniqueName('report.pdf', ['report.pdf', 'report (2).pdf'])).toBe('report (3).pdf');
  });

  it('classifies extensions and MIME types', () => {
    expect(kindFromExt('DOCX')).toBe('word');
    expect(kindFromExt('unknown')).toBe('other');
    expect(kindFromMime('application/pdf')).toBe('pdf');
    expect(kindFromMime('image/webp')).toBe('image');
    expect(kindFromMime('application/vnd.ms-excel')).toBe('excel');
    expect(kindFromMime()).toBeUndefined();
    expect(kindMeta('pdf')).toMatchObject({ label: 'PDF', accent: 'red' });
  });
});
