import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  deletePages,
  duplicatePages,
  extractPages,
  getPageCount,
  getPdfPageSize,
  insertBlankPage,
  pageSizeDimensions,
  reorderPages,
  rotatePages,
  splitPdf,
} from './pdf';

async function createPdf(sizes: Array<[number, number]>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  sizes.forEach((size) => document.addPage(size));
  return document.save();
}

async function pageSizes(bytes: Uint8Array): Promise<Array<[number, number]>> {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [width, height];
  });
}

describe('PDF page operations', () => {
  it('reports page sizes and handles malformed input', async () => {
    const bytes = await createPdf([[200, 300]]);

    await expect(getPageCount(bytes)).resolves.toBe(1);
    await expect(getPageCount(Uint8Array.from([1, 2, 3]))).resolves.toBe(0);
    await expect(getPdfPageSize(bytes)).resolves.toEqual({ width: 200, height: 300 });
    expect(pageSizeDimensions('letter', 'landscape')).toEqual([792, 612]);
  });

  it('extracts, reorders, deletes, and splits pages without rasterizing them', async () => {
    const source = await createPdf([
      [100, 200],
      [110, 210],
      [120, 220],
    ]);

    await expect(pageSizes(await extractPages(source, [2, 0, 99]))).resolves.toEqual([
      [120, 220],
      [100, 200],
    ]);
    await expect(pageSizes(await reorderPages(source, [1, 0]))).resolves.toEqual([
      [110, 210],
      [100, 200],
    ]);
    await expect(getPageCount(await deletePages(source, [1]))).resolves.toBe(2);

    const parts = await splitPdf(source, [[0], [1, 2]]);
    await expect(Promise.all(parts.map(getPageCount))).resolves.toEqual([1, 2]);
  });

  it('duplicates, inserts, and rotates selected pages', async () => {
    const source = await createPdf([
      [200, 300],
      [400, 500],
    ]);
    await expect(getPageCount(await duplicatePages(source, [0]))).resolves.toBe(3);

    const withBlank = await insertBlankPage(source, 1, 'fit');
    expect(await pageSizes(withBlank)).toEqual([
      [200, 300],
      [200, 300],
      [400, 500],
    ]);

    const rotated = await PDFDocument.load(await rotatePages(source, [1], 90));
    expect(rotated.getPage(0).getRotation().angle).toBe(0);
    expect(rotated.getPage(1).getRotation().angle).toBe(90);
  });
});
