/**
 * Native OCR stub. tesseract.js targets the browser; on a device, scanned-PDF
 * OCR is done server-side via the "Searchable PDF" tool.
 */
export const ocrAvailable = false;

export async function recognizeImage(
  _src: string,
  _lang: string,
  _onProgress?: (p: number) => void,
): Promise<string> {
  throw new Error(
    'On-device OCR runs in the FileMint web app. For scanned PDFs, use “Searchable PDF” (server).',
  );
}
