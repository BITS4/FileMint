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
});
