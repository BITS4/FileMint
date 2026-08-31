export type ApplyScope = 'current' | 'selected' | 'range' | 'all';
export type CropPointKey = 'tl' | 'tr' | 'br' | 'bl';
export type CropTarget = CropPointKey | 'top' | 'right' | 'bottom' | 'left' | 'move';
export type CropPoint = { x: number; y: number };
export type CropQuad = Record<CropPointKey, CropPoint>;

export function cloneQuad(quad: CropQuad): CropQuad {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

export function clamp01(value: number): number {
  return Math.max(0.02, Math.min(0.98, value));
}

export function parsePositiveNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function parsePageRange(value: string, pageCount: number): number[] {
  const pages = new Set<number>();
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [startRaw, endRaw] = part.split('-').map((item) => Number(item.trim()));
      if (!Number.isFinite(startRaw)) return;
      const start = Math.max(1, Math.min(pageCount, startRaw));
      const end = Number.isFinite(endRaw) ? Math.max(1, Math.min(pageCount, endRaw)) : start;
      const low = Math.min(start, end);
      const high = Math.max(start, end);
      for (let page = low; page <= high; page++) pages.add(page - 1);
    });
  return [...pages].sort((a, b) => a - b);
}

export function targetPagesForScope(
  scope: ApplyScope,
  pageIndex: number,
  pageCount: number,
  range: string,
): number[] {
  if (scope === 'all') return Array.from({ length: pageCount }, (_, index) => index);
  if (scope === 'range') {
    const parsed = parsePageRange(range, pageCount);
    return parsed.length ? parsed : [pageIndex];
  }
  return [pageIndex];
}

export function cropEdgesFromQuad(quad: CropQuad) {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  return {
    top: Math.min(...ys) * 100,
    right: (1 - Math.max(...xs)) * 100,
    bottom: (1 - Math.max(...ys)) * 100,
    left: Math.min(...xs) * 100,
    unit: 'percent' as const,
  };
}

export function pointAt(a: CropPoint, b: CropPoint, amount: number): CropPoint {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount };
}

export function rectFromQuad(quad: CropQuad): CropQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    tl: { x: left, y: top },
    tr: { x: right, y: top },
    br: { x: right, y: bottom },
    bl: { x: left, y: bottom },
  };
}

export function moveQuad(quad: CropQuad, dx: number, dy: number): CropQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const safeDx = Math.max(-Math.min(...xs) + 0.02, Math.min(1 - Math.max(...xs) - 0.02, dx));
  const safeDy = Math.max(-Math.min(...ys) + 0.02, Math.min(1 - Math.max(...ys) - 0.02, dy));
  return {
    tl: { x: quad.tl.x + safeDx, y: quad.tl.y + safeDy },
    tr: { x: quad.tr.x + safeDx, y: quad.tr.y + safeDy },
    br: { x: quad.br.x + safeDx, y: quad.br.y + safeDy },
    bl: { x: quad.bl.x + safeDx, y: quad.bl.y + safeDy },
  };
}
