import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { imageToPdfPage, imagesToPdf } from './pdf';

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlXIAAAAASUVORK5CYII=',
    'base64',
  ),
);

describe('image PDF generation', () => {
  it('embeds an image on an explicitly sized page', async () => {
    const bytes = await imageToPdfPage(
      { bytes: ONE_PIXEL_PNG, ext: 'png' },
      { width: 320, height: 240, margin: 20, fit: 'contain' },
    );
    const page = (await PDFDocument.load(bytes)).getPage(0);

    expect(page.getSize()).toEqual({ width: 320, height: 240 });
  });

  it('creates one fitted page per image', async () => {
    const bytes = await imagesToPdf(
      [
        { bytes: ONE_PIXEL_PNG, ext: 'png' },
        { bytes: ONE_PIXEL_PNG, ext: 'png' },
      ],
      { pageSize: 'fit', orientation: 'portrait', margin: 12, fit: 'stretch' },
    );
    const document = await PDFDocument.load(bytes);

    expect(document.getPageCount()).toBe(2);
    expect(document.getPage(0).getSize()).toEqual({ width: 25, height: 25 });
  });
});
