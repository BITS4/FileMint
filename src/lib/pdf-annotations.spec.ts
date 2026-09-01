import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  addPageNumbers,
  addTextToPage,
  addWatermark,
  cropPdf,
  cropPdfEdges,
  flattenForms,
  markAreaOnPage,
} from './pdf';

async function createPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([600, 800]);
  document.addPage([400, 500]);
  return document.save();
}

describe('PDF annotations', () => {
  it('adds text, page numbers, marks, and watermarks to valid documents', async () => {
    let bytes = await createPdf();
    bytes = await addTextToPage(bytes, {
      pageIndex: 99,
      text: 'Approved',
      position: 'top-right',
      fontSize: 18,
      color: { r: 0.1, g: 0.2, b: 0.3 },
      bold: true,
    });
    bytes = await addPageNumbers(bytes, {
      position: 'bottom-center',
      startAt: 1,
      fontSize: 10,
      format: '{n} / {total}',
      margin: 24,
    });
    bytes = await markAreaOnPage(bytes, {
      pageIndex: 0,
      position: 'center',
      color: { r: 1, g: 0.9, b: 0 },
      opacity: 0.4,
    });
    bytes = await addWatermark(bytes, {
      text: 'FILEMINT',
      fontSize: 28,
      opacity: 0.2,
      color: { r: 0.2, g: 0.2, b: 0.2 },
      rotation: 35,
    });

    await expect(PDFDocument.load(bytes)).resolves.toBeInstanceOf(PDFDocument);
  });

  it('applies uniform and independent crop boxes safely', async () => {
    const uniformlyCropped = await PDFDocument.load(await cropPdf(await createPdf(), 25));
    expect(uniformlyCropped.getPage(0).getCropBox()).toMatchObject({
      x: 25,
      y: 25,
      width: 550,
      height: 750,
    });

    const edgeCropped = await PDFDocument.load(
      await cropPdfEdges(
        await createPdf(),
        { left: 10, right: 20, top: 5, bottom: 15, unit: 'percent' },
        [0],
      ),
    );
    expect(edgeCropped.getPage(0).getCropBox()).toMatchObject({
      x: 60,
      y: 120,
      width: 420,
      height: 640,
    });
    expect(edgeCropped.getPage(1).getCropBox()).toMatchObject({ x: 0, y: 0, width: 400, height: 500 });
  });

  it('normalizes documents without form fields', async () => {
    await expect(PDFDocument.load(await flattenForms(await createPdf()))).resolves.toBeInstanceOf(
      PDFDocument,
    );
  });

  it('covers every text, number, and mark position with safe option defaults', async () => {
    let bytes = await createPdf();

    for (const position of ['top-left', 'bottom-left', 'center'] as const) {
      bytes = await addTextToPage(bytes, {
        pageIndex: -10,
        text: position,
        position,
        fontSize: 12,
        color: { r: 0, g: 0, b: 0 },
      });
    }

    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      bytes = await markAreaOnPage(bytes, {
        pageIndex: 0,
        position,
        color: { r: 0.2, g: 0.4, b: 0.6 },
        opacity: 0.25,
        widthRatio: 0.3,
        height: 20,
      });
    }

    for (const position of ['top-center', 'top-right', 'bottom-left', 'bottom-right'] as const) {
      bytes = await addPageNumbers(bytes, {
        position,
        startAt: 10,
        fontSize: 9,
        format: '{n}',
        margin: 18,
      });
    }

    await expect(PDFDocument.load(bytes)).resolves.toBeInstanceOf(PDFDocument);
  });

  it('handles point crops, omitted targets, and hostile edge values', async () => {
    const cropped = await PDFDocument.load(
      await cropPdfEdges(await createPdf(), {
        left: -5,
        right: Number.NaN,
        bottom: 900,
        top: 12,
        unit: 'points',
      }),
    );

    expect(cropped.getPage(0).getCropBox()).toMatchObject({ x: 0, y: 900, width: 600, height: 1 });
    expect(cropped.getPage(1).getCropBox()).toMatchObject({ x: 0, y: 900, width: 400, height: 1 });

    const clampedPercent = await PDFDocument.load(
      await cropPdfEdges(await createPdf(), { left: 200, top: 200 }),
    );
    expect(clampedPercent.getPage(0).getCropBox()).toMatchObject({ x: 570, y: 0, width: 30, height: 40 });

    const safeUniformCrop = await PDFDocument.load(await cropPdf(await createPdf(), -25));
    expect(safeUniformCrop.getPage(0).getCropBox()).toMatchObject({ x: 0, y: 0, width: 600, height: 800 });
  });
});
