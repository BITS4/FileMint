import { describe, expect, it } from 'vitest';

import {
  clamp01,
  cloneQuad,
  cropEdgesFromQuad,
  moveQuad,
  parsePageRange,
  parsePositiveNumber,
  rectFromQuad,
  targetPagesForScope,
  type CropQuad,
} from './geometry';

const QUAD: CropQuad = {
  tl: { x: 0.1, y: 0.2 },
  tr: { x: 0.9, y: 0.1 },
  br: { x: 0.8, y: 0.85 },
  bl: { x: 0.2, y: 0.9 },
};

describe('PDF editor geometry', () => {
  it('parses, clamps, deduplicates, and sorts page ranges', () => {
    expect(parsePageRange('3-1, 2, 9, invalid', 5)).toEqual([0, 1, 2, 4]);
  });

  it('resolves page scopes with a current-page fallback', () => {
    expect(targetPagesForScope('all', 1, 3, '')).toEqual([0, 1, 2]);
    expect(targetPagesForScope('range', 1, 3, '')).toEqual([1]);
    expect(targetPagesForScope('current', 2, 3, '1')).toEqual([2]);
  });

  it('converts a perspective quad into edge percentages', () => {
    const edges = cropEdgesFromQuad(QUAD);
    expect(edges.top).toBeCloseTo(10);
    expect(edges.right).toBeCloseTo(10);
    expect(edges.bottom).toBeCloseTo(10);
    expect(edges.left).toBeCloseTo(10);
    expect(edges.unit).toBe('percent');
  });

  it('normalizes a perspective quad to its bounding rectangle', () => {
    expect(rectFromQuad(QUAD)).toEqual({
      tl: { x: 0.1, y: 0.1 },
      tr: { x: 0.9, y: 0.1 },
      br: { x: 0.9, y: 0.9 },
      bl: { x: 0.1, y: 0.9 },
    });
  });

  it('keeps moved crop handles inside the safe canvas', () => {
    const moved = moveQuad(QUAD, 1, -1);
    expect(Math.max(...Object.values(moved).map((point) => point.x))).toBeCloseTo(0.98);
    expect(Math.min(...Object.values(moved).map((point) => point.y))).toBeCloseTo(0.02);
  });

  it('clones points and clamps numeric editor inputs', () => {
    const cloned = cloneQuad(QUAD);
    cloned.tl.x = 0.5;
    expect(QUAD.tl.x).toBe(0.1);
    expect(clamp01(-1)).toBe(0.02);
    expect(clamp01(2)).toBe(0.98);
    expect(parsePositiveNumber('14', 10, 8, 12)).toBe(12);
    expect(parsePositiveNumber('bad', 10, 8, 12)).toBe(10);
  });
});
