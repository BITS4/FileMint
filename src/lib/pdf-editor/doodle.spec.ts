import { describe, expect, it } from 'vitest';

import {
  distanceToSegment,
  doodleTouchesPoint,
  splitDoodleObjectAt,
  splitSegmentAroundPoint,
} from './doodle';
import type { EditorObject } from './types';

const stroke: EditorObject = {
  id: 'stroke-1',
  pageIndex: 0,
  type: 'doodle',
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  color: '#000000',
  opacity: 1,
  thickness: 4,
  rotation: 0,
  points: [
    { x: 0.1, y: 0.5 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.5 },
  ],
};

describe('PDF editor doodle eraser', () => {
  it('measures distance to regular and zero-length segments', () => {
    expect(distanceToSegment({ x: 0.5, y: 0.7 }, { x: 0, y: 0.5 }, { x: 1, y: 0.5 })).toBeCloseTo(0.2);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  it('detects hits on points and between sampled points', () => {
    expect(doodleTouchesPoint(stroke, { x: 0.5, y: 0.53 }, 0.04)).toBe(true);
    expect(doodleTouchesPoint(stroke, { x: 0.3, y: 0.52 }, 0.03)).toBe(true);
    expect(doodleTouchesPoint(stroke, { x: 0.3, y: 0.8 }, 0.03)).toBe(false);
  });

  it('computes a bounded gap around an eraser hit', () => {
    expect(splitSegmentAroundPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0 }, 0.1)).toEqual({
      before: { x: 0.4, y: 0 },
      after: { x: 0.6, y: 0 },
    });
    expect(splitSegmentAroundPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 0.1)).toEqual({
      before: undefined,
      after: undefined,
    });
  });

  it('splits a hit stroke but preserves an untouched stroke', () => {
    const longStroke = {
      ...stroke,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
        { x: 0.95, y: 0.5 },
      ],
    };
    const split = splitDoodleObjectAt(longStroke, { x: 0.5, y: 0.5 }, 0.05);
    expect(split).toHaveLength(2);
    expect(split[0].id).toBe(stroke.id);
    expect(split[0].points?.at(-1)?.x).toBeLessThan(0.5);
    expect(split[1].points?.[0]?.x).toBeGreaterThan(0.5);
    expect(splitDoodleObjectAt(stroke, { x: 0.5, y: 0.9 }, 0.05)).toEqual([stroke]);
  });
});
