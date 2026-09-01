/** Core offline PDF page and image operations. */
import { PDFDocument, degrees } from 'pdf-lib';

export type PageSizeKey = 'a4' | 'letter' | 'legal' | 'fit';
export type Orientation = 'portrait' | 'landscape';

export const PAGE_SIZES: Record<Exclude<PageSizeKey, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

export async function load(bytes: Uint8Array): Promise<PDFDocument> {
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

export function pageSizeDimensions(
  size: Exclude<PageSizeKey, 'fit'>,
  orientation: Orientation,
): [number, number] {
  const [a, b] = PAGE_SIZES[size];
  return orientation === 'landscape' ? [b, a] : [a, b];
}

export async function getPdfPageSize(
  bytes: Uint8Array,
  pageIndex = 0,
): Promise<{ width: number; height: number }> {
  const doc = await load(bytes);
  if (doc.getPageCount() === 0) return { width: PAGE_SIZES.a4[0], height: PAGE_SIZES.a4[1] };
  const page = doc.getPage(Math.max(0, Math.min(pageIndex, doc.getPageCount() - 1)));
  const box = page.getCropBox();
  return { width: box.width, height: box.height };
}

export interface ImageToPdfPageOptions {
  width: number;
  height: number;
  margin?: number;
  fit?: 'contain' | 'cover' | 'stretch';
}

export async function imageToPdfPage(image: InputImage, opts: ImageToPdfPageOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const isPng = image.ext.toLowerCase() === 'png';
  const embedded = isPng ? await doc.embedPng(image.bytes) : await doc.embedJpg(image.bytes);
  const pw = Math.max(1, opts.width);
  const ph = Math.max(1, opts.height);
  const margin = Math.max(0, opts.margin ?? 0);
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
  return doc.save();
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
      [pw, ph] = pageSizeDimensions(opts.pageSize, opts.orientation);
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
