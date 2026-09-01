import { PDFDocument, degrees } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import {
  PAGE_SIZES,
  buildFromPageModel,
  deletePages,
  duplicatePages,
  extractPages,
  getPageCount,
  getPdfPageSize,
  imageToPdfPage,
  imagesToPdf,
  insertBlankPage,
  load,
  mergePdfs,
  pageSizeDimensions,
  reorderPages,
  rotatePages,
  splitPdf,
} from './pdf-core';

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlXIAAAAASUVORK5CYII=',
    'base64',
  ),
);

const TWO_BY_ONE_JPEG = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/wAALCAABAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z',
    'base64',
  ),
);

async function createPdf(pages: Array<{ size: [number, number]; rotation?: number }>): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (const definition of pages) {
    const page = document.addPage(definition.size);
    if (definition.rotation) page.setRotation(degrees(definition.rotation));
  }
  return document.save();
}

async function inspect(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  return document.getPages().map((page) => ({
    size: [page.getSize().width, page.getSize().height] as [number, number],
    rotation: page.getRotation().angle,
  }));
}

describe('PDF core page geometry and loading', () => {
  it('resolves every standard page orientation and clamps page lookups', async () => {
    expect(pageSizeDimensions('a4', 'portrait')).toEqual(PAGE_SIZES.a4);
    expect(pageSizeDimensions('letter', 'landscape')).toEqual([792, 612]);
    expect(pageSizeDimensions('legal', 'portrait')).toEqual([612, 1008]);

    const source = await createPdf([{ size: [100, 200] }, { size: [300, 400] }]);
    await expect(getPdfPageSize(source, -100)).resolves.toEqual({ width: 100, height: 200 });
    await expect(getPdfPageSize(source, 100)).resolves.toEqual({ width: 300, height: 400 });
    await expect(getPageCount(source)).resolves.toBe(2);
    await expect(load(source)).resolves.toBeInstanceOf(PDFDocument);
    await expect(getPageCount(Uint8Array.from([0, 1, 2]))).resolves.toBe(0);
  });

  it('uses A4 dimensions when a valid PDF has no pages', async () => {
    const empty = await PDFDocument.create();
    const bytes = await empty.save();

    await expect(getPdfPageSize(bytes)).resolves.toEqual({
      width: PAGE_SIZES.a4[0],
      height: PAGE_SIZES.a4[1],
    });
  });
});

describe('PDF core image placement', () => {
  it('embeds PNG and JPEG pages across contain, cover, stretch, and default options', async () => {
    const contain = await imageToPdfPage(
      { bytes: ONE_PIXEL_PNG, ext: 'PNG' },
      { width: 120, height: 80, margin: 10, fit: 'contain' },
    );
    const cover = await imageToPdfPage(
      { bytes: TWO_BY_ONE_JPEG, ext: 'jpeg' },
      { width: 90, height: 140, margin: -5, fit: 'cover' },
    );
    const stretch = await imageToPdfPage(
      { bytes: ONE_PIXEL_PNG, ext: 'png' },
      { width: 60, height: 70, margin: 100, fit: 'stretch' },
    );
    const defaults = await imageToPdfPage({ bytes: TWO_BY_ONE_JPEG, ext: 'jpg' }, { width: 0, height: -20 });

    await expect(inspect(contain)).resolves.toEqual([{ size: [120, 80], rotation: 0 }]);
    await expect(inspect(cover)).resolves.toEqual([{ size: [90, 140], rotation: 0 }]);
    await expect(inspect(stretch)).resolves.toEqual([{ size: [60, 70], rotation: 0 }]);
    await expect(inspect(defaults)).resolves.toEqual([{ size: [1, 1], rotation: 0 }]);
  });

  it('creates fitted and fixed pages for mixed image formats and fit modes', async () => {
    const fitted = await imagesToPdf([{ bytes: TWO_BY_ONE_JPEG, ext: 'JPG' }], {
      pageSize: 'fit',
      orientation: 'portrait',
      margin: 3,
    });
    await expect(inspect(fitted)).resolves.toEqual([{ size: [8, 7], rotation: 0 }]);

    const covered = await imagesToPdf(
      [
        { bytes: ONE_PIXEL_PNG, ext: 'png' },
        { bytes: TWO_BY_ONE_JPEG, ext: 'jpeg' },
      ],
      { pageSize: 'letter', orientation: 'landscape', margin: 12, fit: 'cover' },
    );
    expect((await inspect(covered)).map((page) => page.size)).toEqual([
      [792, 612],
      [792, 612],
    ]);

    const stretched = await imagesToPdf([{ bytes: ONE_PIXEL_PNG, ext: 'png' }], {
      pageSize: 'legal',
      orientation: 'portrait',
      margin: -10,
      fit: 'stretch',
    });
    await expect(inspect(stretched)).resolves.toEqual([{ size: [612, 1008], rotation: 0 }]);
  });
});

describe('PDF core page composition', () => {
  it('merges, extracts, reorders, deletes, and splits page fixtures', async () => {
    const first = await createPdf([{ size: [100, 200] }, { size: [110, 210] }]);
    const second = await createPdf([{ size: [120, 220] }]);
    const merged = await mergePdfs([first, second]);
    expect((await inspect(merged)).map((page) => page.size)).toEqual([
      [100, 200],
      [110, 210],
      [120, 220],
    ]);

    expect((await inspect(await extractPages(merged, [-1, 2, 99, 0]))).map((page) => page.size)).toEqual([
      [120, 220],
      [100, 200],
    ]);
    expect((await inspect(await reorderPages(merged, [1, 0]))).map((page) => page.size)).toEqual([
      [110, 210],
      [100, 200],
    ]);
    await expect(getPageCount(await deletePages(merged, [0, 2]))).resolves.toBe(1);
    await expect(getPageCount(await duplicatePages(merged, [1]))).resolves.toBe(4);

    const parts = await splitPdf(merged, [[0, 2], [1]]);
    await expect(Promise.all(parts.map(getPageCount))).resolves.toEqual([2, 1]);
  });

  it('inserts clamped standard pages and combines existing rotations', async () => {
    const source = await createPdf([{ size: [100, 200], rotation: 270 }, { size: [300, 400] }]);
    const prepended = await insertBlankPage(source, -10, 'letter', 'landscape');
    expect((await inspect(prepended)).map((page) => page.size)).toEqual([
      [792, 612],
      [100, 200],
      [300, 400],
    ]);

    const appended = await insertBlankPage(source, 99, 'legal', 'portrait');
    expect((await inspect(appended)).map((page) => page.size)).toEqual([
      [100, 200],
      [300, 400],
      [612, 1008],
    ]);

    const rotated = await rotatePages(source, [0], 180);
    expect((await inspect(rotated)).map((page) => page.rotation)).toEqual([90, 0]);
  });

  it('uses the first page dimensions when inserting a fitted blank', async () => {
    const source = await createPdf([{ size: [240, 360] }]);
    const result = await insertBlankPage(source, 1, 'fit');
    expect(await inspect(result)).toEqual([
      { size: [240, 360], rotation: 0 },
      { size: [240, 360], rotation: 0 },
    ]);
  });
});

describe('PDF page-model rebuilding', () => {
  it('reorders, duplicates, rotates, inserts blanks, and skips invalid source pages', async () => {
    const source = await createPdf([{ size: [100, 200], rotation: 90 }, { size: [300, 400] }]);
    const rebuilt = await buildFromPageModel(source, [
      { srcIndex: 1, rotation: -90 },
      { srcIndex: 0, rotation: 180 },
      { srcIndex: 0, rotation: 0 },
      { srcIndex: null, rotation: -90 },
      { srcIndex: null, rotation: 0 },
      { srcIndex: 99, rotation: 45 },
    ]);

    expect(await inspect(rebuilt)).toEqual([
      { size: [300, 400], rotation: 270 },
      { size: [100, 200], rotation: 270 },
      { size: [100, 200], rotation: 90 },
      { size: PAGE_SIZES.a4, rotation: 270 },
      { size: PAGE_SIZES.a4, rotation: 0 },
    ]);
  });
});
