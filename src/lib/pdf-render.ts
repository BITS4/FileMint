/**
 * Native stub for page rasterization. pdf.js runs in the browser; on a device
 * these features route through the conversion server instead. Signatures mirror
 * pdf-render.web.ts so tsc (which resolves this file) stays happy.
 */
export interface RenderedImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg';
}

export async function renderPdfToImages(
  _bytes: Uint8Array,
  _format: 'png' | 'jpg' = 'png',
  _scale = 2,
  _onProgress?: (p: number) => void,
): Promise<RenderedImage[]> {
  throw new Error('Rendering pages to images runs on the web app or the conversion server.');
}

export async function extractPdfText(_bytes: Uint8Array, _onProgress?: (p: number) => void): Promise<string> {
  throw new Error('Text extraction runs on the web app or the conversion server.');
}
