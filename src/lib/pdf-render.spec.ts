import { describe, expect, it } from 'vitest';
import { extractPdfText, renderPdfToImages } from './pdf-render';

describe('native PDF rendering boundary', () => {
  it('routes image rendering to the web app or conversion server', async () => {
    await expect(renderPdfToImages(new Uint8Array([1]))).rejects.toThrow(
      'Rendering pages to images runs on the web app or the conversion server.',
    );
  });

  it('routes text extraction to the web app or conversion server', async () => {
    await expect(extractPdfText(new Uint8Array([1]))).rejects.toThrow(
      'Text extraction runs on the web app or the conversion server.',
    );
  });
});
