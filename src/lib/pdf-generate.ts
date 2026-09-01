/** PDF optimization and text/CSV document generation. */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

import { PAGE_SIZES, load, type PageSizeKey } from './pdf-core';
import { safePdfText } from './pdf-editor.geometry';

/**
 * Structural compression: re-saves with object streams and strips metadata.
 * This is honest "lossless" optimization; it does not down-sample embedded
 * images (that needs a rasterizer and is handled server-side).
 */
export async function optimizePdf(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await load(bytes);
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}

export interface TextPdfOptions {
  title?: string;
  fontSize?: number;
  mono?: boolean;
  pageSize?: Exclude<PageSizeKey, 'fit'>;
}

/** Render plain text into a paginated PDF with simple word wrapping. */
export async function textToPdf(text: string, opts: TextPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(opts.mono ? StandardFonts.Courier : StandardFonts.Helvetica);
  const fontSize = opts.fontSize ?? 11;
  const lineHeight = fontSize * 1.4;
  const [pw, ph] = PAGE_SIZES[opts.pageSize ?? 'a4'];
  const margin = 48;
  const maxWidth = pw - margin * 2;

  const wrap = (line: string): string[] => {
    if (line === '') return [''];
    const words = line.split(/(\s+)/);
    const out: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current + word;
      if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current !== '') {
        out.push(current.trimEnd());
        current = word.trimStart();
      } else {
        current = candidate;
      }
    }
    if (current.trim() !== '' || out.length === 0) out.push(current.trimEnd());
    return out;
  };

  const allLines = safePdfText(text).replace(/\r\n/g, '\n').split('\n').flatMap(wrap);
  let page = doc.addPage([pw, ph]);
  let y = ph - margin;

  if (opts.title) {
    page.drawText(safePdfText(opts.title), { x: margin, y, size: fontSize + 6, font, color: rgb(0, 0, 0) });
    y -= lineHeight * 2;
  }

  for (const line of allLines) {
    if (y < margin) {
      page = doc.addPage([pw, ph]);
      y = ph - margin;
    }
    page.drawText(line, { x: margin, y, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineHeight;
  }

  return doc.save();
}

export async function csvRowsToPdf(rows: string[][], title = 'Table'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [pw, ph] = PAGE_SIZES.a4;
  const margin = 34;
  const fontSize = 8;
  const lineHeight = 10;
  const rowMinHeight = 24;
  const usableWidth = pw - margin * 2;
  const cols = Math.min(12, Math.max(1, ...rows.map((r) => r.length)));
  const sample = rows.slice(0, 200);
  const weights = Array.from({ length: cols }, (_, c) =>
    Math.max(8, Math.min(32, ...sample.map((r) => safePdfText((r[c] ?? '').trim()).length))),
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  const widths = weights.map((w) => Math.max(42, (w / totalWeight) * usableWidth));
  const widthTotal = widths.reduce((sum, w) => sum + w, 0);
  const scale = usableWidth / widthTotal;
  for (let i = 0; i < widths.length; i++) widths[i] *= scale;

  let page = doc.addPage([pw, ph]);
  let y = ph - margin;

  const addPage = () => {
    page = doc.addPage([pw, ph]);
    y = ph - margin;
  };

  const drawTitle = () => {
    page.drawText(safePdfText(title), { x: margin, y, size: 14, font: bold, color: rgb(0.05, 0.07, 0.1) });
    y -= 24;
  };

  const wrapCell = (text: string, width: number): string[] => {
    const clean = safePdfText(text.trim());
    if (!clean) return [''];
    const words = clean.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) > width - 8 && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, 5);
  };

  const drawRow = (row: string[], index: number) => {
    const wrapped = Array.from({ length: cols }, (_, c) => wrapCell(row[c] ?? '', widths[c]));
    const height = Math.max(
      rowMinHeight,
      Math.max(...wrapped.map((lines) => lines.length)) * lineHeight + 10,
    );
    if (y - height < margin) addPage();
    const header = index === 0;
    const fill = header ? rgb(0.88, 0.94, 1) : index % 2 === 0 ? rgb(0.98, 0.99, 1) : rgb(1, 1, 1);
    page.drawRectangle({ x: margin, y: y - height, width: usableWidth, height, color: fill });
    let x = margin;
    for (let c = 0; c < cols; c++) {
      page.drawRectangle({
        x,
        y: y - height,
        width: widths[c],
        height,
        borderColor: rgb(0.72, 0.78, 0.85),
        borderWidth: 0.5,
      });
      const f = header ? bold : font;
      wrapped[c].forEach((line, i) => {
        page.drawText(line, {
          x: x + 4,
          y: y - 14 - i * lineHeight,
          size: fontSize,
          font: f,
          color: rgb(0.08, 0.09, 0.12),
        });
      });
      x += widths[c];
    }
    y -= height;
  };

  drawTitle();
  rows.forEach(drawRow);
  return doc.save();
}
