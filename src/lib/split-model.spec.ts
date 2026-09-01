import { describe, expect, it } from 'vitest';

import { groupEachPage, groupEveryPages, parsePageRanges } from './split-model';

describe('page range parsing', () => {
  it('returns zero-based groups and normalizes reversed ranges', () => {
    expect(parsePageRanges('1-3, 5, 9-7', 10)).toEqual([[0, 1, 2], [4], [6, 7, 8]]);
  });

  it.each(['2abc', '2.5', '1--3', '-2', 'one', '1-2-3'])('rejects malformed token %j', (token) => {
    expect(() => parsePageRanges(token, 10)).toThrow(/not a valid/);
  });

  it.each(['', '   '])('requires at least one range for %j', (input) => {
    expect(() => parsePageRanges(input, 10)).toThrow(/at least one/);
  });

  it.each(['1,,2', ',1', '1,'])('rejects empty comma-separated entries in %j', (input) => {
    expect(() => parsePageRanges(input, 10)).toThrow(/empty entries/);
  });

  it.each([
    ['0', 10],
    ['11', 10],
    ['1-11', 10],
    ['0-2', 10],
  ])('rejects out-of-range expression %s', (input, total) => {
    expect(() => parsePageRanges(input, total as number)).toThrow(/out of range/);
  });

  it('rejects documents without readable pages', () => {
    expect(() => parsePageRanges('1', 0)).toThrow(/readable pages/);
  });
});

describe('automatic page grouping', () => {
  it('keeps a final partial group', () => {
    expect(groupEveryPages('3', 8)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
  });

  it.each(['0', '-1', '2.5', '2pages', '', ' '])('rejects invalid group size %j', (size) => {
    expect(() => groupEveryPages(size, 8)).toThrow(/Pages per file/);
  });

  it('creates one group per page', () => {
    expect(groupEachPage(3)).toEqual([[0], [1], [2]]);
  });
});
