/**
 * Web page rasterization + text extraction via pdf.js. Used by PDF->JPG/PNG and
 * PDF->Text. The generic build is safe in Expo dev; callers fall back to the
 * conversion server if the browser worker cannot be loaded.
 */
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface RenderedImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg';
}

export async function renderPdfToImages(
  bytes: Uint8Array,
  format: 'png' | 'jpg' = 'png',
  scale = 2,
  onProgress?: (p: number) => void,
): Promise<RenderedImage[]> {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  const out: RenderedImage[] = [];
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');
    await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encode failed.'))), mime, 0.92),
    );
    out.push({ bytes: new Uint8Array(await blob.arrayBuffer()), ext: format });
    onProgress?.(i / doc.numPages);
  }
  return out;
}

export async function extractPdfText(bytes: Uint8Array, onProgress?: (p: number) => void): Promise<string> {
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items
      .map((it: unknown) => (typeof it === 'object' && it !== null && 'str' in it ? String((it as { str?: string }).str ?? '') : ''))
      .join(' ') + '\n\n';
    onProgress?.(i / doc.numPages);
  }
  return text.trim();
}
