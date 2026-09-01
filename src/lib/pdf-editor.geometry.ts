/** Low-level PDF editor geometry and drawing primitives. */
import { LineCapStyle, degrees, rgb, type PDFFont, type PDFDocument, type PDFPage } from 'pdf-lib';

import { base64ToBytes } from './base64';
import type { PdfEditorObjectExport } from './pdf-editor.types';

export function safePdfText(text: string): string {
  return text.replace(/[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/g, '?');
}

export function colorFromHex(hex: string | undefined, fallback = '#2BD9A8') {
  const value = (hex || fallback).replace('#', '').trim();
  const clean = /^[0-9a-f]{6}$/i.test(value) ? value : fallback.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

export function pageRect(page: PDFPage, left: number, top: number, width: number, height: number) {
  const size = page.getSize();
  return {
    x: size.width * left,
    y: size.height * (1 - top - height),
    width: size.width * width,
    height: size.height * height,
  };
}

export function pageObjectRect(page: PDFPage, object: PdfEditorObjectExport) {
  const left = Math.max(0, Math.min(0.98, object.x ?? 0.18));
  const top = Math.max(0, Math.min(0.98, object.y ?? 0.24));
  const width = Math.max(0.01, Math.min(1 - left, object.width ?? 0.42));
  const height = Math.max(0.01, Math.min(1 - top, object.height ?? 0.08));
  return pageRect(page, left, top, width, height);
}

export function pagePoint(page: PDFPage, point: { x: number; y: number }) {
  const size = page.getSize();
  return {
    x: Math.max(0, Math.min(1, point.x)) * size.width,
    y: (1 - Math.max(0, Math.min(1, point.y))) * size.height,
  };
}

export function drawPdfLine(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
) {
  page.drawLine({ start, end, color, opacity, thickness, lineCap: LineCapStyle.Round });
}

export function pdfSvgPathFromPoints(page: PDFPage, points: { x: number; y: number }[]) {
  if (!points.length) return '';
  const size = page.getSize();
  return points
    .map((point, index) => {
      const x = Math.max(0, Math.min(1, point.x)) * size.width;
      const y = Math.max(0, Math.min(1, point.y)) * size.height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function drawPdfDoodlePath(
  page: PDFPage,
  points: { x: number; y: number }[],
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
) {
  const path = pdfSvgPathFromPoints(page, points);
  if (!path) return;
  page.drawSvgPath(path, {
    x: 0,
    y: page.getHeight(),
    borderColor: color,
    borderOpacity: opacity,
    borderWidth: thickness,
    borderLineCap: LineCapStyle.Round,
    scale: 1,
  });
}

export function pdfSvgPathInRect(rect: ReturnType<typeof pageRect>, points: { x: number; y: number }[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => {
      const x = Math.max(0, Math.min(1, point.x)) * rect.width;
      const y = Math.max(0, Math.min(1, point.y)) * rect.height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function drawPdfSignaturePaths(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  paths: { x: number; y: number }[][],
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
  rotation: number,
) {
  for (const points of paths) {
    const path = pdfSvgPathInRect(rect, points);
    if (!path) continue;
    page.drawSvgPath(path, {
      x: rect.x,
      y: rect.y + rect.height,
      rotate: degrees(rotation),
      borderColor: color,
      borderOpacity: opacity,
      borderWidth: Math.max(0.8, Math.min(12, thickness)),
      borderLineCap: LineCapStyle.Round,
      scale: 1,
    });
  }
}

export function parseImageDataUrl(value: string | undefined) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(value ?? '');
  if (!match) return null;
  return {
    mime: match[1].toLowerCase(),
    bytes: base64ToBytes(match[2]),
  };
}

export function drawPdfArrowHead(
  page: PDFPage,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(10, Math.min(28, Math.hypot(end.x - start.x, end.y - start.y) * 0.16));
  const spread = Math.PI / 7;
  const left = { x: end.x - Math.cos(angle - spread) * size, y: end.y - Math.sin(angle - spread) * size };
  const right = { x: end.x - Math.cos(angle + spread) * size, y: end.y - Math.sin(angle + spread) * size };
  drawPdfLine(page, left, end, color, opacity, thickness);
  drawPdfLine(page, right, end, color, opacity, thickness);
}

export function drawTextLines(
  page: PDFPage,
  text: string,
  rect: ReturnType<typeof pageRect>,
  font: PDFFont,
  fontSize: number,
  color: ReturnType<typeof rgb>,
  opacity: number,
  align: 'left' | 'center' | 'right' = 'left',
  underline = false,
) {
  const lines = safePdfText(text).replace(/\r\n/g, '\n').split('\n');
  const lineHeight = fontSize * 1.22;
  let y = rect.y + rect.height - fontSize - 4;
  for (const line of lines) {
    if (y < rect.y + 2) break;
    const printable = line || ' ';
    const maxWidth = Math.max(8, rect.width - 12);
    const textWidth = Math.min(font.widthOfTextAtSize(printable, fontSize), maxWidth);
    const x =
      align === 'center'
        ? rect.x + (rect.width - textWidth) / 2
        : align === 'right'
          ? rect.x + rect.width - textWidth - 6
          : rect.x + 6;
    page.drawText(line || ' ', {
      x,
      y,
      size: fontSize,
      font,
      color,
      opacity,
      maxWidth,
    });
    if (underline) {
      page.drawLine({
        start: { x, y: y - 2 },
        end: { x: x + textWidth, y: y - 2 },
        color,
        opacity,
        thickness: Math.max(0.6, fontSize * 0.07),
      });
    }
    y -= lineHeight;
  }
}

export function validTargets(doc: PDFDocument, indices: number[]): number[] {
  const max = doc.getPageCount() - 1;
  const clean = indices.filter((i) => Number.isInteger(i) && i >= 0 && i <= max);
  return [...new Set(clean.length ? clean : [0].filter((i) => i <= max))];
}

export function drawDoodle(page: PDFPage, color: ReturnType<typeof rgb>, opacity: number, thickness: number) {
  const size = page.getSize();
  const points = [
    [0.16, 0.68],
    [0.24, 0.6],
    [0.34, 0.64],
    [0.46, 0.54],
    [0.6, 0.58],
    [0.74, 0.48],
  ].map(([x, y]) => ({ x: x * size.width, y: (1 - y) * size.height }));
  for (let i = 0; i < points.length - 1; i++) {
    page.drawLine({
      start: points[i],
      end: points[i + 1],
      thickness,
      color,
      opacity,
    });
  }
}
