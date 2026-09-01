/** Focused text, numbering, watermark, crop, and form operations. */
import { StandardFonts, degrees, rgb } from 'pdf-lib';

import { load } from './pdf-core';

export type NumberPosition = 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-center';

export interface PageNumberOptions {
  position: NumberPosition;
  startAt: number;
  fontSize: number;
  /** Use {n} for current page and {total} for total, e.g. "{n} / {total}". */
  format: string;
  margin: number;
}

export async function addPageNumbers(bytes: Uint8Array, opts: PageNumberOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    const label = opts.format
      .replace('{n}', String(opts.startAt + i))
      .replace('{total}', String(opts.startAt + total - 1));
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, opts.fontSize);
    const m = opts.margin;
    let x = (width - textWidth) / 2;
    let y = m;
    if (opts.position.includes('right')) x = width - textWidth - m;
    if (opts.position.includes('left')) x = m;
    if (opts.position.startsWith('top')) y = height - opts.fontSize - m;
    page.drawText(label, { x, y, size: opts.fontSize, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return doc.save();
}

export type StampPosition =
  'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface AddTextOptions {
  pageIndex: number;
  text: string;
  position: StampPosition;
  fontSize: number;
  color: { r: number; g: number; b: number };
  bold?: boolean;
}

/** Draw a line of text at a preset position on a single page. */
export async function addTextToPage(bytes: Uint8Array, opts: AddTextOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error('The PDF has no pages.');
  const idx = Math.max(0, Math.min(opts.pageIndex, pages.length - 1));
  const page = pages[idx];
  const font = await doc.embedFont(opts.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const { width, height } = page.getSize();
  const textWidth = font.widthOfTextAtSize(opts.text, opts.fontSize);
  const m = 36;

  let x: number;
  if (opts.position.includes('left')) x = m;
  else if (opts.position.includes('right')) x = width - textWidth - m;
  else x = (width - textWidth) / 2;

  let y: number;
  if (opts.position.startsWith('top')) y = height - opts.fontSize - m;
  else if (opts.position.startsWith('bottom')) y = m;
  else y = (height - opts.fontSize) / 2;

  page.drawText(opts.text, {
    x,
    y,
    size: opts.fontSize,
    font,
    color: rgb(opts.color.r, opts.color.g, opts.color.b),
  });
  return doc.save();
}

export interface MarkAreaOptions {
  pageIndex: number;
  position: StampPosition;
  color: { r: number; g: number; b: number };
  opacity: number;
  widthRatio?: number;
  height?: number;
}

export async function markAreaOnPage(bytes: Uint8Array, opts: MarkAreaOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error('The PDF has no pages.');
  const idx = Math.max(0, Math.min(opts.pageIndex, pages.length - 1));
  const page = pages[idx];
  const { width, height } = page.getSize();
  const rectW = width * (opts.widthRatio ?? 0.62);
  const rectH = opts.height ?? 34;
  const m = 42;
  let x = (width - rectW) / 2;
  if (opts.position.includes('left')) x = m;
  if (opts.position.includes('right')) x = width - rectW - m;
  let y = (height - rectH) / 2;
  if (opts.position.startsWith('top')) y = height - rectH - m;
  if (opts.position.startsWith('bottom')) y = m;
  page.drawRectangle({
    x,
    y,
    width: rectW,
    height: rectH,
    color: rgb(opts.color.r, opts.color.g, opts.color.b),
    opacity: opts.opacity,
  });
  return doc.save();
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  opacity: number; // 0..1
  color: { r: number; g: number; b: number }; // 0..1 each
  rotation: number; // degrees
}

export async function addWatermark(bytes: Uint8Array, opts: WatermarkOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(opts.text, opts.fontSize);
    page.drawText(opts.text, {
      x: width / 2 - (textWidth / 2) * Math.cos((opts.rotation * Math.PI) / 180),
      y: height / 2 - (textWidth / 2) * Math.sin((opts.rotation * Math.PI) / 180),
      size: opts.fontSize,
      font,
      color: rgb(opts.color.r, opts.color.g, opts.color.b),
      opacity: opts.opacity,
      rotate: degrees(opts.rotation),
    });
  });
  return doc.save();
}

/** Trim a uniform margin (in points) from every page via the crop box. */
export async function cropPdf(bytes: Uint8Array, margin: number): Promise<Uint8Array> {
  const doc = await load(bytes);
  const m = Math.max(0, margin);
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const w = Math.max(1, width - m * 2);
    const h = Math.max(1, height - m * 2);
    page.setCropBox(m, m, w, h);
  });
  return doc.save();
}

export interface CropEdges {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  unit?: 'percent' | 'points';
}

/** Crop selected pages by independent edges while preserving original PDF vectors/text. */
export async function cropPdfEdges(
  bytes: Uint8Array,
  edges: CropEdges,
  indices?: number[],
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const targets = indices ? new Set(indices) : null;
  const unit = edges.unit ?? 'percent';

  doc.getPages().forEach((page, index) => {
    if (targets && !targets.has(index)) return;
    const { width, height } = page.getSize();
    const toPoints = (value: number | undefined, axis: number) => {
      const clean = Math.max(0, Number.isFinite(value ?? 0) ? (value ?? 0) : 0);
      return unit === 'percent' ? (axis * Math.min(clean, 95)) / 100 : clean;
    };
    const left = toPoints(edges.left, width);
    const right = toPoints(edges.right, width);
    const bottom = toPoints(edges.bottom, height);
    const top = toPoints(edges.top, height);
    const nextWidth = Math.max(1, width - left - right);
    const nextHeight = Math.max(1, height - top - bottom);
    page.setCropBox(left, bottom, nextWidth, nextHeight);
  });

  return doc.save();
}

export async function flattenForms(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  try {
    doc.getForm().flatten();
  } catch {
    // No form fields to flatten; saving still normalizes the document.
  }
  return doc.save();
}
