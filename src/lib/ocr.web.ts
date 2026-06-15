/** Web OCR via tesseract.js (loads language data from the tesseract CDN). */
import { recognize } from 'tesseract.js';

export const ocrAvailable = true;

export async function recognizeImage(src: string, lang: string, onProgress?: (p: number) => void): Promise<string> {
  const result = await recognize(src, lang || 'eng', {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  return result.data.text.trim();
}
