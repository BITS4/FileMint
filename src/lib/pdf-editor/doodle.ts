import { makeObjectId } from './model';
import type { EditorObject, EditorPoint } from './types';

export function distanceToSegment(point: EditorPoint, a: EditorPoint, b: EditorPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

export function pointOnSegment(a: EditorPoint, b: EditorPoint, t: number): EditorPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function splitSegmentAroundPoint(a: EditorPoint, b: EditorPoint, point: EditorPoint, radius: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { before: undefined, after: undefined };
  const len = Math.sqrt(lenSq);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const gap = Math.min(0.48, Math.max(radius / len, 0.015));
  const beforeT = t - gap;
  const afterT = t + gap;
  return {
    before: beforeT > 0 ? pointOnSegment(a, b, beforeT) : undefined,
    after: afterT < 1 ? pointOnSegment(a, b, afterT) : undefined,
  };
}

export function doodleTouchesPoint(object: EditorObject, point: EditorPoint, radius: number) {
  const points = object.points ?? [];
  if (points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius))
    return true;
  for (let index = 0; index < points.length - 1; index++) {
    if (distanceToSegment(point, points[index], points[index + 1]) <= radius) return true;
  }
  return false;
}

export function splitDoodleObjectAt(
  object: EditorObject,
  point: EditorPoint,
  radius: number,
): EditorObject[] {
  const points = object.points ?? [];
  if (points.length < 2 || !doodleTouchesPoint(object, point, radius)) return [object];
  const groups: EditorPoint[][] = [];
  let current: EditorPoint[] = [points[0]];

  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const hit = distanceToSegment(point, a, b) <= radius;
    if (!hit) {
      if (!current.length) current = [a];
      current.push(b);
      continue;
    }

    const split = splitSegmentAroundPoint(a, b, point, radius);
    if (split.before && current.length) current.push(split.before);
    if (current.length > 1) groups.push(current);
    current = split.after ? [split.after] : [];
  }

  if (current.length > 1) groups.push(current);
  return groups.map((group, index) => ({
    ...object,
    id: index === 0 ? object.id : makeObjectId(),
    points: group,
  }));
}
