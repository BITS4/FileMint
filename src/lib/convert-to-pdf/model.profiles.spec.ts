import { describe, expect, it } from 'vitest';
import type { FileItem } from '@/types';
import {
  OFFICE_TYPES,
  normalizeProfile,
  pickTypes,
  profileTitle,
  supportsProfile,
  type StudioProfile,
} from './model';

const file = (kind: FileItem['kind'], ext: string) => ({ kind, ext }) as FileItem;

describe('convert-to-PDF profiles', () => {
  it('publishes a distinct title for every route profile', () => {
    const expected: Record<StudioProfile, string> = {
      all: 'Convert to PDF',
      image: 'Images to PDF',
      word: 'Word to PDF',
      ppt: 'PowerPoint to PDF',
      excel: 'Excel to PDF',
      csv: 'CSV to PDF',
      text: 'Text to PDF',
      batch: 'Batch to PDF',
    };

    for (const [profile, title] of Object.entries(expected)) {
      expect(profileTitle(profile as StudioProfile)).toBe(title);
    }
  });

  it('maps every focused profile to its intended picker MIME types', () => {
    expect(pickTypes('image')).toBe('image/*');
    expect(pickTypes('word')).toEqual(OFFICE_TYPES.slice(0, 2));
    expect(pickTypes('ppt')).toEqual(OFFICE_TYPES.slice(2, 4));
    expect(pickTypes('excel')).toEqual(OFFICE_TYPES.slice(4, 6));
    expect(pickTypes('csv')).toEqual(['text/csv', 'text/comma-separated-values', 'text/plain']);
    expect(pickTypes('text')).toEqual(['text/plain', 'text/markdown', 'text/*']);
    expect(pickTypes('batch')).toEqual(['image/*', 'text/*', ...OFFICE_TYPES]);
  });

  it('accepts each supported kind only in the matching focused profile', () => {
    expect(supportsProfile(file('ppt', 'pptx'), 'ppt')).toBe(true);
    expect(supportsProfile(file('excel', 'xlsx'), 'excel')).toBe(true);
    expect(supportsProfile(file('csv', 'csv'), 'csv')).toBe(true);
    expect(supportsProfile(file('text', 'csv'), 'csv')).toBe(true);
    expect(supportsProfile(file('text', 'txt'), 'text')).toBe(true);
    expect(supportsProfile(file('text', 'csv'), 'text')).toBe(false);
    expect(supportsProfile(file('archive', 'zip'), 'batch')).toBe(false);
  });

  it('allows all convertible kinds in all/batch mode and rejects unrelated kinds', () => {
    for (const [kind, ext] of [
      ['image', 'jpg'],
      ['word', 'docx'],
      ['ppt', 'pptx'],
      ['excel', 'xlsx'],
      ['csv', 'csv'],
      ['text', 'md'],
    ] as const) {
      expect(supportsProfile(file(kind, ext), 'all')).toBe(true);
    }
    expect(supportsProfile(file('other', 'txt'), 'all')).toBe(false);
  });

  it('normalizes every supported scalar or array route value', () => {
    for (const profile of ['image', 'word', 'ppt', 'excel', 'csv', 'text', 'batch'] as const) {
      expect(normalizeProfile(profile)).toBe(profile);
      expect(normalizeProfile([profile, 'ignored'])).toBe(profile);
    }
    expect(normalizeProfile([])).toBe('all');
    expect(normalizeProfile(null)).toBe('all');
  });
});
