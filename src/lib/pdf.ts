/**
 * Offline PDF operations built on pdf-lib. Everything here is pure
 * (Uint8Array in -> Uint8Array out) so it runs identically on web and native
 * and is easy to test. Rendering pages to images (thumbnails / PDF->image)
 * needs a rasterizer and lives in pdf-render.* instead.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

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
