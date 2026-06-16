/**
 * Offline PDF operations built on pdf-lib. Everything here is pure
 * (Uint8Array in -> Uint8Array out) so it runs identically on web and native
 * and is easy to test. Rendering pages to images (thumbnails / PDF->image)
 * needs a rasterizer and lives in pdf-render.* instead.
 */
import { LineCapStyle, PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

import { base64ToBytes } from './base64';

export type PageSizeKey = 'a4' | 'letter' | 'legal' | 'fit';
export type Orientation = 'portrait' | 'landscape';

const PAGE_SIZES: Record<Exclude<PageSizeKey, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
}

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await load(bytes);
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

export interface ImagesToPdfOptions {
  pageSize: PageSizeKey;
  orientation: Orientation;
  /** Margin in points (1pt = 1/72 inch). */
  margin: number;
  fit?: 'contain' | 'cover' | 'stretch';
}

export interface InputImage {
  bytes: Uint8Array;
  /** 'png' or 'jpg'/'jpeg'. Other formats must be normalized by the caller. */
  ext: string;
}

export async function imagesToPdf(images: InputImage[], opts: ImagesToPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const margin = Math.max(0, opts.margin);

  for (const img of images) {
    const isPng = img.ext.toLowerCase() === 'png';
    const embedded = isPng ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);

    let pw: number;
    let ph: number;
    if (opts.pageSize === 'fit') {
      pw = embedded.width + margin * 2;
      ph = embedded.height + margin * 2;
    } else {
      const [a, b] = PAGE_SIZES[opts.pageSize];
      [pw, ph] = opts.orientation === 'landscape' ? [b, a] : [a, b];
    }

    const page = doc.addPage([pw, ph]);
    const maxW = Math.max(1, pw - margin * 2);
    const maxH = Math.max(1, ph - margin * 2);
    const fit = opts.fit ?? 'contain';
    const drawScale =
      fit === 'stretch'
        ? 1
        : fit === 'cover'
          ? Math.max(maxW / embedded.width, maxH / embedded.height)
          : Math.min(maxW / embedded.width, maxH / embedded.height);
    const w = fit === 'stretch' ? maxW : embedded.width * drawScale;
    const h = fit === 'stretch' ? maxH : embedded.height * drawScale;
    page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  }

  return doc.save();
}

export async function mergePdfs(list: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of list) {
    const src = await load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Build one new PDF containing exactly `indices` (0-based) in that order. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const valid = indices.filter((i) => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, valid);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const remove = new Set(indices);
  const keep = src.getPageIndices().filter((i) => !remove.has(i));
  return extractPages(bytes, keep);
}

/** `order` is the full list of source page indices in their new order. */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<Uint8Array> {
  return extractPages(bytes, order);
}

export async function splitPdf(bytes: Uint8Array, ranges: number[][]): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  for (const range of ranges) {
    results.push(await extractPages(bytes, range));
  }
  return results;
}

/** Rotate the given pages by `deltaDeg` (added to current rotation). */
export async function rotatePages(
  bytes: Uint8Array,
  indices: number[],
  deltaDeg: number,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const target = new Set(indices);
  doc.getPages().forEach((page, i) => {
    if (!target.has(i)) return;
    const current = page.getRotation().angle ?? 0;
    page.setRotation(degrees((current + deltaDeg) % 360));
  });
  return doc.save();
}

/** Duplicate each page in `indices`, inserting the copy right after it. */
export async function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const dup = new Set(indices);
  const order: number[] = [];
  for (const i of src.getPageIndices()) {
    order.push(i);
    if (dup.has(i)) order.push(i);
  }
  return extractPages(bytes, order);
}

export async function insertBlankPage(
  bytes: Uint8Array,
  atIndex: number,
  size: PageSizeKey = 'a4',
  orientation: Orientation = 'portrait',
): Promise<Uint8Array> {
  const doc = await load(bytes);
  let dims: [number, number];
  if (size === 'fit') {
    const first = doc.getPage(0);
    const s = first?.getSize();
    dims = s ? [s.width, s.height] : PAGE_SIZES.a4;
  } else {
    const [a, b] = PAGE_SIZES[size];
    dims = orientation === 'landscape' ? [b, a] : [a, b];
  }
  const clamped = Math.max(0, Math.min(atIndex, doc.getPageCount()));
  doc.insertPage(clamped, dims);
  return doc.save();
}

export interface PageModelItem {
  /** Source page index, or null for an inserted blank page. */
  srcIndex: number | null;
  /** Extra rotation in degrees added on top of the source rotation. */
  rotation: number;
}

/** Rebuild a PDF from a page model that supports reorder / delete / duplicate / blank / rotate. */
export async function buildFromPageModel(srcBytes: Uint8Array, items: PageModelItem[]): Promise<Uint8Array> {
  const src = await load(srcBytes);
  const out = await PDFDocument.create();
  const srcIndices = items
    .filter((i) => i.srcIndex !== null && i.srcIndex >= 0 && i.srcIndex < src.getPageCount())
    .map((i) => i.srcIndex as number);
  const copied = await out.copyPages(src, srcIndices);

  let cursor = 0;
  for (const item of items) {
    if (item.srcIndex === null) {
      const page = out.addPage(PAGE_SIZES.a4);
      if (item.rotation) page.setRotation(degrees(((item.rotation % 360) + 360) % 360));
    } else {
      const page = copied[cursor++];
      if (!page) continue;
      out.addPage(page);
      const base = page.getRotation().angle ?? 0;
      if (item.rotation) page.setRotation(degrees((((base + item.rotation) % 360) + 360) % 360));
    }
  }
  return out.save();
}

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
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

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

  page.drawText(opts.text, { x, y, size: opts.fontSize, font, color: rgb(opts.color.r, opts.color.g, opts.color.b) });
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
      const clean = Math.max(0, Number.isFinite(value ?? 0) ? value ?? 0 : 0);
      return unit === 'percent' ? axis * Math.min(clean, 95) / 100 : clean;
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

export type PdfEditorTool =
  | 'doodle'
  | 'highlight'
  | 'add-stamp'
  | 'add-signature'
  | 'flatten'
  | 'add-watermark'
  | 'annotate'
  | 'redact'
  | 'add-text'
  | 'add-page-numbers'
  | 'fill-forms';

export interface PdfEditorExportOptions {
  tool: PdfEditorTool;
  targetPages: number[];
  text?: string;
  stampText?: string;
  stampDetail?: string;
  stampMode?: 'design' | 'upload';
  stampShape?: 'box' | 'pill' | 'seal';
  stampStyle?: 'outline' | 'filled' | 'double';
  stampImageDataUrl?: string;
  stampImageName?: string;
  signatureText?: string;
  annotationText?: string;
  redactLabel?: string;
  color?: string;
  opacity?: number;
  thickness?: number;
  fontSize?: number;
  rotation?: number;
}

export type PdfEditorObjectType = 'text' | 'watermark' | 'stamp' | 'signature' | 'doodle' | 'highlight' | 'annotate' | 'redact' | 'form-field';

export interface PdfEditorObjectExport {
  type: PdfEditorObjectType;
  pageIndex: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  opacity?: number;
  thickness?: number;
  fontSize?: number;
  rotation?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  stampDetail?: string;
  stampMode?: 'design' | 'upload';
  stampShape?: 'box' | 'pill' | 'seal';
  stampStyle?: 'outline' | 'filled' | 'double';
  stampImageDataUrl?: string;
  stampImageName?: string;
  signatureMode?: 'draw' | 'type' | 'upload';
  signaturePoints?: { x: number; y: number }[];
  signaturePaths?: { x: number; y: number }[][];
  signatureImageDataUrl?: string;
  signatureImageName?: string;
  formFieldKind?: 'text' | 'checkbox' | 'date' | 'signature' | 'initials';
  formValue?: string;
  formPlaceholder?: string;
  formChecked?: boolean;
  formRequired?: boolean;
  doodleMode?: 'pencil' | 'marker' | 'eraser' | 'vector' | 'arrow';
  annotationMode?: 'note' | 'callout' | 'shape';
  points?: { x: number; y: number }[];
}

function colorFromHex(hex: string | undefined, fallback = '#2BD9A8') {
  const value = (hex || fallback).replace('#', '').trim();
  const clean = /^[0-9a-f]{6}$/i.test(value) ? value : fallback.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function pageRect(page: PDFPage, left: number, top: number, width: number, height: number) {
  const size = page.getSize();
  return {
    x: size.width * left,
    y: size.height * (1 - top - height),
    width: size.width * width,
    height: size.height * height,
  };
}

function pageObjectRect(page: PDFPage, object: PdfEditorObjectExport) {
  const left = Math.max(0, Math.min(0.98, object.x ?? 0.18));
  const top = Math.max(0, Math.min(0.98, object.y ?? 0.24));
  const width = Math.max(0.01, Math.min(1 - left, object.width ?? 0.42));
  const height = Math.max(0.01, Math.min(1 - top, object.height ?? 0.08));
  return pageRect(page, left, top, width, height);
}

function pagePoint(page: PDFPage, point: { x: number; y: number }) {
  const size = page.getSize();
  return {
    x: Math.max(0, Math.min(1, point.x)) * size.width,
    y: (1 - Math.max(0, Math.min(1, point.y))) * size.height,
  };
}

function drawPdfLine(page: PDFPage, start: { x: number; y: number }, end: { x: number; y: number }, color: ReturnType<typeof rgb>, opacity: number, thickness: number) {
  page.drawLine({ start, end, color, opacity, thickness, lineCap: LineCapStyle.Round });
}

function pdfSvgPathFromPoints(page: PDFPage, points: { x: number; y: number }[]) {
  if (!points.length) return '';
  const size = page.getSize();
  return points
    .map((point, index) => {
      const x = Math.max(0, Math.min(1, point.x)) * size.width;
      const y = Math.max(0, Math.min(1, point.y)) * size.height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function drawPdfDoodlePath(page: PDFPage, points: { x: number; y: number }[], color: ReturnType<typeof rgb>, opacity: number, thickness: number) {
  const path = pdfSvgPathFromPoints(page, points);
  if (!path) return;
  page.drawSvgPath(path, {
    x: 0,
    y: page.getHeight(),
    borderColor: color,
    borderOpacity: opacity,
    borderWidth: thickness,
    borderLineCap: LineCapStyle.Round,
    scale: 1,
  });
}

function pdfSvgPathInRect(rect: ReturnType<typeof pageRect>, points: { x: number; y: number }[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => {
      const x = Math.max(0, Math.min(1, point.x)) * rect.width;
      const y = Math.max(0, Math.min(1, point.y)) * rect.height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function drawPdfSignaturePaths(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  paths: { x: number; y: number }[][],
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
  rotation: number,
) {
  for (const points of paths) {
    const path = pdfSvgPathInRect(rect, points);
    if (!path) continue;
    page.drawSvgPath(path, {
      x: rect.x,
      y: rect.y + rect.height,
      rotate: degrees(rotation),
      borderColor: color,
      borderOpacity: opacity,
      borderWidth: Math.max(0.8, Math.min(12, thickness)),
      borderLineCap: LineCapStyle.Round,
      scale: 1,
    });
  }
}

function parseImageDataUrl(value: string | undefined) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value ?? '');
  if (!match) return null;
  return {
    mime: match[1].toLowerCase(),
    bytes: base64ToBytes(match[2]),
  };
}

function drawPdfArrowHead(page: PDFPage, start: { x: number; y: number }, end: { x: number; y: number }, color: ReturnType<typeof rgb>, opacity: number, thickness: number) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(10, Math.min(28, Math.hypot(end.x - start.x, end.y - start.y) * 0.16));
  const spread = Math.PI / 7;
  const left = { x: end.x - Math.cos(angle - spread) * size, y: end.y - Math.sin(angle - spread) * size };
  const right = { x: end.x - Math.cos(angle + spread) * size, y: end.y - Math.sin(angle + spread) * size };
  drawPdfLine(page, left, end, color, opacity, thickness);
  drawPdfLine(page, right, end, color, opacity, thickness);
}

function drawTextLines(
  page: PDFPage,
  text: string,
  rect: ReturnType<typeof pageRect>,
  font: PDFFont,
  fontSize: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
  align: 'left' | 'center' | 'right' = 'left',
  underline = false,
) {
  const lines = safePdfText(text).replace(/\r\n/g, '\n').split('\n');
  const lineHeight = fontSize * 1.22;
  let y = rect.y + rect.height - fontSize - 4;
  for (const line of lines) {
    if (y < rect.y + 2) break;
    const printable = line || ' ';
    const maxWidth = Math.max(8, rect.width - 12);
    const textWidth = Math.min(font.widthOfTextAtSize(printable, fontSize), maxWidth);
    const x =
      align === 'center'
        ? rect.x + (rect.width - textWidth) / 2
        : align === 'right'
          ? rect.x + rect.width - textWidth - 6
          : rect.x + 6;
    page.drawText(line || ' ', {
      x,
      y,
      size: fontSize,
      font,
      color,
      opacity,
      maxWidth,
    });
    if (underline) {
      page.drawLine({
        start: { x, y: y - 2 },
        end: { x: x + textWidth, y: y - 2 },
        color,
        opacity,
        thickness: Math.max(0.6, fontSize * 0.07),
      });
    }
    y -= lineHeight;
  }
}

function validTargets(doc: PDFDocument, indices: number[]): number[] {
  const max = doc.getPageCount() - 1;
  const clean = indices.filter((i) => Number.isInteger(i) && i >= 0 && i <= max);
  return [...new Set(clean.length ? clean : [0].filter((i) => i <= max))];
}

function drawDoodle(page: PDFPage, color: ReturnType<typeof rgb>, opacity: number, thickness: number) {
  const size = page.getSize();
  const points = [
    [0.16, 0.68],
    [0.24, 0.6],
    [0.34, 0.64],
    [0.46, 0.54],
    [0.6, 0.58],
    [0.74, 0.48],
  ].map(([x, y]) => ({ x: x * size.width, y: (1 - y) * size.height }));
  for (let i = 0; i < points.length - 1; i++) {
    page.drawLine({
      start: points[i],
      end: points[i + 1],
      thickness,
      color,
      opacity,
    });
  }
}

function drawStamp(page: PDFPage, text: string, color: ReturnType<typeof rgb>, opacity: number, rotation: number) {
  const rect = pageRect(page, 0.24, 0.55, 0.48, 0.11);
  page.drawRectangle({
    ...rect,
    color: rgb(1, 1, 1),
    opacity: 0.08,
    borderColor: color,
    borderOpacity: opacity,
    borderWidth: 3,
    rotate: degrees(rotation),
  });
  page.drawText(safePdfText(text || 'APPROVED'), {
    x: rect.x + 18,
    y: rect.y + rect.height / 2 - 10,
    size: Math.max(18, Math.min(34, rect.height * 0.38)),
    color,
    opacity,
    rotate: degrees(rotation),
  });
}

function drawPremiumStamp(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  text: string,
  detail: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
  rotation: number,
  shape: 'box' | 'pill' | 'seal' = 'box',
  style: 'outline' | 'filled' | 'double' = 'double',
  boldFont?: PDFFont,
  regularFont?: PDFFont,
) {
  const borderWidth = Math.max(1.6, Math.min(8, thickness * 0.8));
  const fillOpacity = style === 'filled' ? Math.min(0.22, opacity * 0.24) : 0.035;
  const drawOval = shape === 'pill' || shape === 'seal';
  const inset = Math.max(4, borderWidth * 1.8);
  if (drawOval) {
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: rect.width / 2,
      yScale: rect.height / 2,
      color,
      opacity: fillOpacity,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
      rotate: degrees(rotation),
    });
    if (style === 'double') {
      page.drawEllipse({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        xScale: Math.max(2, rect.width / 2 - inset),
        yScale: Math.max(2, rect.height / 2 - inset),
        borderColor: color,
        borderOpacity: Math.min(0.8, opacity),
        borderWidth: Math.max(0.8, borderWidth * 0.45),
        rotate: degrees(rotation),
      });
    }
  } else {
    page.drawRectangle({
      ...rect,
      color,
      opacity: fillOpacity,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
      rotate: degrees(rotation),
    });
    if (style === 'double') {
      page.drawRectangle({
        x: rect.x + inset,
        y: rect.y + inset,
        width: Math.max(2, rect.width - inset * 2),
        height: Math.max(2, rect.height - inset * 2),
        borderColor: color,
        borderOpacity: Math.min(0.8, opacity),
        borderWidth: Math.max(0.8, borderWidth * 0.45),
        rotate: degrees(rotation),
      });
    }
  }

  const label = safePdfText((text || 'APPROVED').toUpperCase()).slice(0, 34);
  const small = safePdfText((detail || 'VERIFIED').toUpperCase()).slice(0, 36);
  const labelFont = boldFont;
  const detailFont = regularFont ?? boldFont;
  const labelSize = Math.max(10, Math.min(34, rect.height * (shape === 'seal' ? 0.24 : 0.32), (rect.width / Math.max(4, label.length)) * 1.65));
  const detailSize = Math.max(6, Math.min(12, rect.height * 0.14, (rect.width / Math.max(6, small.length)) * 1.45));
  const labelWidth = labelFont?.widthOfTextAtSize(label, labelSize) ?? label.length * labelSize * 0.55;
  const detailWidth = detailFont?.widthOfTextAtSize(small, detailSize) ?? small.length * detailSize * 0.5;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  page.drawText(label, {
    x: centerX - labelWidth / 2,
    y: centerY - labelSize * 0.22,
    size: labelSize,
    font: labelFont,
    color,
    opacity,
    rotate: degrees(rotation),
    maxWidth: rect.width - inset * 2,
  });
  if (small) {
    page.drawText(small, {
      x: centerX - detailWidth / 2,
      y: centerY - labelSize * 0.82,
      size: detailSize,
      font: detailFont,
      color,
      opacity: Math.min(0.82, opacity),
      rotate: degrees(rotation),
      maxWidth: rect.width - inset * 2,
    });
  }
}

function drawSignature(page: PDFPage, text: string, color: ReturnType<typeof rgb>, opacity: number, rotation: number) {
  const rect = pageRect(page, 0.42, 0.7, 0.34, 0.1);
  page.drawText(safePdfText(text || 'Signature'), {
    x: rect.x,
    y: rect.y + rect.height * 0.28,
    size: Math.max(18, Math.min(32, rect.height * 0.45)),
    color,
    opacity,
    rotate: degrees(rotation),
  });
  page.drawLine({
    start: { x: rect.x, y: rect.y + rect.height * 0.18 },
    end: { x: rect.x + rect.width, y: rect.y + rect.height * 0.18 },
    color,
    opacity: Math.min(0.65, opacity),
    thickness: 1,
  });
}

function drawWatermark(page: PDFPage, text: string, color: ReturnType<typeof rgb>, opacity: number, rotation: number) {
  const size = page.getSize();
  const clean = safePdfText(text || 'CONFIDENTIAL');
  const fontSize = Math.min(64, Math.max(30, size.width / Math.max(5, clean.length) * 1.6));
  page.drawText(clean, {
    x: size.width * 0.18,
    y: size.height * 0.46,
    size: fontSize,
    color,
    opacity,
    rotate: degrees(rotation),
  });
}

function drawAnnotation(page: PDFPage, text: string, color: ReturnType<typeof rgb>, opacity: number) {
  const rect = pageRect(page, 0.62, 0.18, 0.28, 0.12);
  page.drawRectangle({
    ...rect,
    color: rgb(1, 0.96, 0.55),
    opacity: Math.min(0.92, Math.max(0.25, opacity)),
    borderColor: color,
    borderWidth: 1.4,
  });
  page.drawText(safePdfText(text || 'Review note'), {
    x: rect.x + 8,
    y: rect.y + rect.height - 18,
    size: 10,
    color: rgb(0.08, 0.08, 0.06),
    maxWidth: rect.width - 16,
  });
}

function drawFormField(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  object: PdfEditorObjectExport,
  color: ReturnType<typeof rgb>,
  opacity: number,
  font: PDFFont,
  boldFont: PDFFont,
) {
  const kind = object.formFieldKind ?? 'text';
  const label = safePdfText(object.formPlaceholder ?? '');
  const value = safePdfText(object.formValue ?? '');
  const borderWidth = Math.max(0.8, Math.min(3, object.thickness ?? 1.4));

  if (kind === 'checkbox') {
    const boxSize = Math.min(rect.height, rect.width, 22);
    const box = { x: rect.x, y: rect.y + (rect.height - boxSize) / 2, width: boxSize, height: boxSize };
    page.drawRectangle({
      ...box,
      color,
      opacity: object.formChecked ? Math.min(0.18, opacity * 0.22) : 0,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
    });
    if (object.formChecked) {
      page.drawLine({
        start: { x: box.x + boxSize * 0.22, y: box.y + boxSize * 0.52 },
        end: { x: box.x + boxSize * 0.42, y: box.y + boxSize * 0.28 },
        color,
        opacity,
        thickness: Math.max(1.4, borderWidth),
        lineCap: LineCapStyle.Round,
      });
      page.drawLine({
        start: { x: box.x + boxSize * 0.42, y: box.y + boxSize * 0.28 },
        end: { x: box.x + boxSize * 0.78, y: box.y + boxSize * 0.72 },
        color,
        opacity,
        thickness: Math.max(1.4, borderWidth),
        lineCap: LineCapStyle.Round,
      });
    }
    if (label) {
      page.drawText(label, {
        x: rect.x + boxSize + 8,
        y: rect.y + rect.height / 2 - 4,
        size: Math.max(7, Math.min(12, rect.height * 0.34)),
        font,
        color,
        opacity,
        maxWidth: Math.max(10, rect.width - boxSize - 10),
      });
    }
    return;
  }

  page.drawRectangle({
    ...rect,
    color: rgb(1, 1, 1),
    opacity: Math.min(0.12, opacity * 0.14),
    borderColor: color,
    borderOpacity: opacity,
    borderWidth,
  });

  if (kind === 'signature') {
    const signature = value || safePdfText('Signature');
    page.drawText(signature, {
      x: rect.x + 8,
      y: rect.y + rect.height * 0.45,
      size: Math.max(10, Math.min(24, object.fontSize ?? rect.height * 0.32)),
      font,
      color,
      opacity,
      maxWidth: Math.max(16, rect.width - 16),
    });
    page.drawLine({
      start: { x: rect.x + 8, y: rect.y + rect.height * 0.28 },
      end: { x: rect.x + rect.width - 8, y: rect.y + rect.height * 0.28 },
      color,
      opacity: Math.min(0.7, opacity),
      thickness: 1.2,
    });
    return;
  }

  if (label || object.formRequired) {
    const topLabel = `${label || (kind === 'date' ? 'Date' : kind === 'initials' ? 'Initials' : 'Field')}${object.formRequired ? ' *' : ''}`;
    page.drawText(safePdfText(topLabel), {
      x: rect.x + 6,
      y: rect.y + rect.height - Math.max(8, Math.min(11, rect.height * 0.24)) - 3,
      size: Math.max(6, Math.min(9, rect.height * 0.2)),
      font: boldFont,
      color,
      opacity: Math.min(0.82, opacity),
      maxWidth: Math.max(16, rect.width - 12),
    });
  }

  const printable = value || (kind === 'date' ? 'YYYY-MM-DD' : kind === 'initials' ? 'Initials' : '');
  if (printable) {
    page.drawText(safePdfText(printable), {
      x: rect.x + 6,
      y: rect.y + Math.max(5, rect.height * 0.24),
      size: Math.max(7, Math.min(18, object.fontSize ?? rect.height * 0.28)),
      font,
      color: value ? rgb(0.05, 0.06, 0.1) : color,
      opacity: value ? 1 : Math.min(0.62, opacity),
      maxWidth: Math.max(16, rect.width - 12),
    });
  }
}

function drawRedactionPreview(page: PDFPage, label: string, color: ReturnType<typeof rgb>) {
  const rect = pageRect(page, 0.22, 0.42, 0.48, 0.07);
  page.drawRectangle({ ...rect, color, opacity: 1 });
  const text = safePdfText(label || 'Redacted');
  if (text) {
    page.drawText(text, {
      x: rect.x + 8,
      y: rect.y + rect.height / 2 - 4,
      size: 9,
      color: rgb(1, 1, 1),
      maxWidth: rect.width - 16,
    });
  }
}

/**
 * Applies real PDF edits on top of the original vector/text pages. These edits
 * are drawn into the PDF content stream; the page itself is not rasterized.
 * Redaction here is a visual fallback only. Production redaction uses the
 * server-side PyMuPDF route so hidden text is removed.
 */
export async function applyPdfEditorTool(bytes: Uint8Array, opts: PdfEditorExportOptions): Promise<Uint8Array> {
  const doc = await load(bytes);
  const targets = validTargets(doc, opts.targetPages);
  const color = colorFromHex(opts.color, opts.tool === 'redact' ? '#000000' : '#2BD9A8');
  const opacity = Math.max(0.05, Math.min(1, opts.opacity ?? 0.86));
  const thickness = Math.max(1, Math.min(18, opts.thickness ?? 4));
  const rotation = Number.isFinite(opts.rotation ?? 0) ? opts.rotation ?? 0 : 0;
  const pageNumberFont = opts.tool === 'add-page-numbers' ? await doc.embedFont(StandardFonts.Helvetica) : null;

  if (opts.tool === 'flatten') {
    try {
      doc.getForm().flatten();
    } catch {
      // No AcroForm fields. Saving still normalizes object streams.
    }
    doc.setProducer('FileMint');
    doc.setCreator('FileMint');
    return doc.save({ useObjectStreams: true });
  }

  for (const index of targets) {
    const page = doc.getPage(index);
    if (opts.tool === 'doodle') drawDoodle(page, color, opacity, thickness);
    if (opts.tool === 'highlight') {
      const rect = pageRect(page, 0.18, 0.36, 0.56, 0.052);
      page.drawRectangle({ ...rect, color: colorFromHex(opts.color, '#F7C948'), opacity: Math.min(0.55, opacity) });
      page.drawLine({ start: { x: rect.x, y: rect.y - 3 }, end: { x: rect.x + rect.width, y: rect.y - 3 }, color: colorFromHex(opts.color, '#F7C948'), opacity, thickness: 1.6 });
    }
    if (opts.tool === 'add-stamp') drawStamp(page, opts.stampText ?? opts.text ?? 'APPROVED', color, opacity, rotation || -12);
    if (opts.tool === 'add-signature') drawSignature(page, opts.signatureText ?? opts.text ?? 'Signature', color, opacity, rotation || -8);
    if (opts.tool === 'add-watermark') drawWatermark(page, opts.text ?? 'CONFIDENTIAL', color, Math.min(0.55, opacity), rotation || -34);
    if (opts.tool === 'annotate') drawAnnotation(page, opts.annotationText ?? opts.text ?? 'Review note', color, opacity);
    if (opts.tool === 'redact') drawRedactionPreview(page, opts.redactLabel ?? 'Redacted', colorFromHex(opts.color, '#000000'));
    if (opts.tool === 'add-text') {
      const rect = pageRect(page, 0.19, 0.3, 0.44, 0.08);
      page.drawText(safePdfText(opts.text ?? 'Editable text'), { x: rect.x, y: rect.y + rect.height / 2, size: 14, color, opacity });
    }
    if (opts.tool === 'add-page-numbers' && pageNumberFont) {
      const size = page.getSize();
      const label = `${index + 1}`;
      const fontSize = 11;
      const textWidth = pageNumberFont.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: (size.width - textWidth) / 2,
        y: 28,
        size: fontSize,
        font: pageNumberFont,
        color: rgb(0.24, 0.27, 0.31),
      });
    }
  }

  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}

export async function applyPdfEditorObjects(bytes: Uint8Array, objects: PdfEditorObjectExport[]): Promise<Uint8Array> {
  if (!objects.length) return bytes;
  const doc = await load(bytes);
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalicFont = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const signatureFont = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const maxPage = doc.getPageCount() - 1;

  for (const object of objects) {
    if (!Number.isInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex > maxPage) continue;
    const page = doc.getPage(object.pageIndex);
    const color = colorFromHex(object.color, object.type === 'redact' ? '#000000' : object.type === 'highlight' ? '#F7C948' : '#2BD9A8');
    const opacity = Math.max(0.05, Math.min(1, object.opacity ?? 0.86));
    const thickness = Math.max(1, Math.min(24, object.thickness ?? 4));
    const rotation = Number.isFinite(object.rotation ?? 0) ? object.rotation ?? 0 : 0;

    if (object.type === 'doodle') {
      const points = object.points ?? [];
      if ((object.doodleMode === 'vector' || object.doodleMode === 'arrow') && points.length > 1) {
        const start = pagePoint(page, points[0]);
        const end = pagePoint(page, points[points.length - 1]);
        drawPdfLine(page, start, end, color, opacity, thickness);
        if (object.doodleMode === 'arrow') drawPdfArrowHead(page, start, end, color, opacity, thickness);
      } else {
        drawPdfDoodlePath(page, points, color, opacity, thickness);
      }
      continue;
    }

    const rect = pageObjectRect(page, object);
    if (object.type === 'highlight') {
      page.drawRectangle({
        ...rect,
        color,
        opacity: Math.min(0.58, opacity),
        borderColor: color,
        borderOpacity: Math.min(0.9, opacity),
        borderWidth: 0.8,
      });
      continue;
    }

    if (object.type === 'redact') {
      page.drawRectangle({ ...rect, color: rgb(0, 0, 0), opacity: 1 });
      const label = safePdfText(object.text ?? 'Redacted');
      if (label) {
        page.drawText(label, {
          x: rect.x + 8,
          y: rect.y + rect.height / 2 - 4,
          size: Math.max(7, Math.min(12, rect.height * 0.28)),
          font: boldFont,
          color: rgb(1, 1, 1),
          maxWidth: rect.width - 16,
        });
      }
      continue;
    }

    if (object.type === 'form-field') {
      drawFormField(page, rect, object, color, opacity, regularFont, boldFont);
      continue;
    }

    if (object.type === 'annotate') {
      if (object.annotationMode === 'shape') {
        page.drawRectangle({
          ...rect,
          color: rgb(1, 1, 1),
          opacity: 0,
          borderColor: color,
          borderOpacity: opacity,
          borderWidth: Math.max(1.5, thickness * 0.65),
        });
        continue;
      }
      page.drawRectangle({
        ...rect,
        color: rgb(1, 0.96, 0.55),
        opacity: Math.min(0.92, opacity),
        borderColor: color,
        borderOpacity: opacity,
        borderWidth: 1.2,
      });
      drawTextLines(page, object.text ?? 'Review note', rect, regularFont, Math.max(8, Math.min(13, rect.height * 0.16)), rgb(0.08, 0.08, 0.06), 1);
      if (object.annotationMode === 'callout') {
        page.drawLine({
          start: { x: rect.x + rect.width * 0.16, y: rect.y },
          end: { x: Math.max(0, rect.x - rect.width * 0.16), y: Math.max(0, rect.y - rect.height * 0.22) },
          color,
          opacity,
          thickness: Math.max(1, thickness * 0.35),
        });
      }
      continue;
    }

    if (object.type === 'stamp') {
      if (object.stampMode === 'upload' && object.stampImageDataUrl) {
        const image = parseImageDataUrl(object.stampImageDataUrl);
        if (!image) throw new Error('Could not read the uploaded stamp image.');
        const embedded = image.mime.includes('png')
          ? await doc.embedPng(image.bytes)
          : image.mime.includes('jpeg') || image.mime.includes('jpg')
            ? await doc.embedJpg(image.bytes)
            : null;
        if (!embedded) throw new Error('Uploaded stamps must be PNG or JPG images.');
        page.drawImage(embedded, {
          ...rect,
          opacity,
          rotate: degrees(rotation),
        });
        continue;
      }
      drawPremiumStamp(
        page,
        rect,
        object.text ?? 'APPROVED',
        object.stampDetail ?? 'VERIFIED',
        color,
        opacity,
        thickness,
        rotation,
        object.stampShape ?? 'box',
        object.stampStyle ?? 'double',
        boldFont,
        regularFont,
      );
      continue;
    }

    if (object.type === 'signature') {
      if (object.signatureMode === 'draw') {
        const paths = object.signaturePaths?.length ? object.signaturePaths : object.signaturePoints?.length ? [object.signaturePoints] : [];
        drawPdfSignaturePaths(page, rect, paths, color, opacity, thickness, rotation);
        continue;
      }
      if (object.signatureMode === 'upload' && object.signatureImageDataUrl) {
        const image = parseImageDataUrl(object.signatureImageDataUrl);
        if (!image) throw new Error('Could not read the uploaded signature image.');
        const embedded = image.mime.includes('png')
          ? await doc.embedPng(image.bytes)
          : image.mime.includes('jpeg') || image.mime.includes('jpg')
            ? await doc.embedJpg(image.bytes)
            : null;
        if (!embedded) throw new Error('Uploaded signatures must be PNG or JPG images.');
        page.drawImage(embedded, {
          ...rect,
          opacity,
          rotate: degrees(rotation),
        });
        continue;
      }
      page.drawText(safePdfText(object.text ?? 'Signature'), {
        x: rect.x + 4,
        y: rect.y + rect.height * 0.35,
        size: Math.max(8, Math.min(96, object.fontSize ?? Math.max(13, Math.min(38, rect.height * 0.44)))),
        font: signatureFont,
        color,
        opacity,
        rotate: degrees(rotation),
        maxWidth: Math.max(16, rect.width - 8),
      });
      page.drawLine({
        start: { x: rect.x, y: rect.y + rect.height * 0.2 },
        end: { x: rect.x + rect.width, y: rect.y + rect.height * 0.2 },
        color,
        opacity: Math.min(0.65, opacity),
        thickness: 1,
      });
      continue;
    }

    if (object.type === 'watermark') {
      page.drawText(safePdfText(object.text ?? 'CONFIDENTIAL'), {
        x: rect.x,
        y: rect.y + rect.height * 0.32,
        size: Math.max(22, Math.min(68, rect.height * 0.46)),
        font: boldFont,
        color,
        opacity: Math.min(0.6, opacity),
        rotate: degrees(rotation),
        maxWidth: Math.max(16, rect.width),
      });
      continue;
    }

    if (object.type === 'text') {
      const textFont = object.bold && object.italic ? boldItalicFont : object.bold ? boldFont : object.italic ? italicFont : regularFont;
      drawTextLines(
        page,
        object.text ?? 'Editable text',
        rect,
        textFont,
        Math.max(6, Math.min(96, object.fontSize ?? Math.max(8, Math.min(22, rect.height * 0.24)))),
        color,
        opacity,
        object.align ?? 'left',
        Boolean(object.underline),
      );
    }
  }

  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}

/**
 * Structural compression: re-saves with object streams and strips metadata.
 * This is honest "lossless" optimization; it does not down-sample embedded
 * images (that needs a rasterizer and is handled server-side).
 */
export async function optimizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}

export interface TextPdfOptions {
  title?: string;
  fontSize?: number;
  mono?: boolean;
  pageSize?: Exclude<PageSizeKey, 'fit'>;
}

function safePdfText(text: string): string {
  return text.replace(/[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g, '?');
}

/** Render plain text into a paginated PDF with simple word wrapping. */
export async function textToPdf(text: string, opts: TextPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(opts.mono ? StandardFonts.Courier : StandardFonts.Helvetica);
  const fontSize = opts.fontSize ?? 11;
  const lineHeight = fontSize * 1.4;
  const [pw, ph] = PAGE_SIZES[opts.pageSize ?? 'a4'];
  const margin = 48;
  const maxWidth = pw - margin * 2;

  const wrap = (line: string): string[] => {
    if (line === '') return [''];
    const words = line.split(/(\s+)/);
    const out: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current !== '') {
        out.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    if (current.trim() !== '' || out.length === 0) out.push(current.trimEnd());
    return out;
  };

  const allLines = safePdfText(text).replace(/\r\n/g, '\n').split('\n').flatMap(wrap);
  let page = doc.addPage([pw, ph]);
  let y = ph - margin;

  if (opts.title) {
    page.drawText(safePdfText(opts.title), { x: margin, y, size: fontSize + 6, font, color: rgb(0, 0, 0) });
    y -= lineHeight * 2;
  }

  for (const line of allLines) {
    if (y < margin) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineHeight;
  }

  return doc.save();
}

export async function csvRowsToPdf(rows: string[][], title = 'Table'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE_SIZES.a4;
  const margin = 34;
  const fontSize = 8;
  const lineHeight = 10;
  const rowMinHeight = 24;
  const usableWidth = pw - margin * 2;
  const cols = Math.min(12, Math.max(1, ...rows.map((r) => r.length)));
  const sample = rows.slice(0, 200);
  const weights = Array.from({ length: cols }, (_, c) =>
    Math.max(8, Math.min(32, ...sample.map((r) => safePdfText((r[c] ?? '').trim()).length))),
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const widths = weights.map((w) => Math.max(42, (w / totalWeight) * usableWidth));
  const widthTotal = widths.reduce((sum, w) => sum + w, 0);
  const scale = usableWidth / widthTotal;
  for (let i = 0; i < widths.length; i++) widths[i] *= scale;

  let page = doc.addPage([pw, ph]);
  let y = ph - margin;

  const addPage = () => {
    page = doc.addPage([pw, ph]);
    y = ph - margin;
  };

  const drawTitle = () => {
    page.drawText(safePdfText(title), { x: margin, y, size: 14, font: bold, color: rgb(0.05, 0.07, 0.1) });
    y -= 24;
  };

  const wrapCell = (text: string, width: number): string[] => {
    const clean = safePdfText(text.trim());
    if (!clean) return [''];
    const words = clean.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > width - 8 && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 5);
  };

  const drawRow = (row: string[], index: number) => {
    const wrapped = Array.from({ length: cols }, (_, c) => wrapCell(row[c] ?? '', widths[c]));
    const height = Math.max(rowMinHeight, Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 10);
    if (y - height < margin) addPage();
    const header = index === 0;
    const fill = header ? rgb(0.88, 0.94, 1) : index % 2 === 0 ? rgb(0.98, 0.99, 1) : rgb(1, 1, 1);
    page.drawRectangle({ x: margin, y: y - height, width: usableWidth, height, color: fill });
    let x = margin;
    for (let c = 0; c < cols; c++) {
      page.drawRectangle({
        x,
        y: y - height,
        width: widths[c],
        height,
        borderColor: rgb(0.72, 0.78, 0.85),
        borderWidth: 0.5,
      });
      const f = header ? bold : font;
      wrapped[c].forEach((line, i) => {
        page.drawText(line, { x: x + 4, y: y - 14 - i * lineHeight, size: fontSize, font: f, color: rgb(0.08, 0.09, 0.12) });
      });
      x += widths[c];
    }
    y -= height;
  };

  drawTitle();
  rows.forEach(drawRow);
  return doc.save();
}
