/** Object-specific PDF editor renderers. */
import {
  LineCapStyle,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

import { pageRect, safePdfText } from './pdf-editor.geometry';
import type { PdfEditorObjectExport } from './pdf-editor.types';

export function drawStamp(
  page: PDFPage,
  text: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  rotation: number,
) {
  const rect = pageRect(page, 0.24, 0.55, 0.48, 0.11);
  page.drawRectangle({
    ...rect,
    color: rgb(1, 1, 1),
    opacity: 0.08,
    borderColor: color,
    borderOpacity: opacity,
    borderWidth: 3,
    rotate: degrees(rotation),
  });
  page.drawText(safePdfText(text || 'APPROVED'), {
    x: rect.x + 18,
    y: rect.y + rect.height / 2 - 10,
    size: Math.max(18, Math.min(34, rect.height * 0.38)),
    color,
    opacity,
    rotate: degrees(rotation),
  });
}

export function drawPremiumStamp(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  text: string,
  detail: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  thickness: number,
  rotation: number,
  shape: 'box' | 'pill' | 'seal' = 'box',
  style: 'outline' | 'filled' | 'double' = 'double',
  boldFont?: PDFFont,
  regularFont?: PDFFont,
) {
  const borderWidth = Math.max(1.6, Math.min(8, thickness * 0.8));
  const fillOpacity = style === 'filled' ? Math.min(0.22, opacity * 0.24) : 0.035;
  const drawOval = shape === 'pill' || shape === 'seal';
  const inset = Math.max(4, borderWidth * 1.8);
  if (drawOval) {
    page.drawEllipse({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
      xScale: rect.width / 2,
      yScale: rect.height / 2,
      color,
      opacity: fillOpacity,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
      rotate: degrees(rotation),
    });
    if (style === 'double') {
      page.drawEllipse({
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        xScale: Math.max(2, rect.width / 2 - inset),
        yScale: Math.max(2, rect.height / 2 - inset),
        borderColor: color,
        borderOpacity: Math.min(0.8, opacity),
        borderWidth: Math.max(0.8, borderWidth * 0.45),
        rotate: degrees(rotation),
      });
    }
  } else {
    page.drawRectangle({
      ...rect,
      color,
      opacity: fillOpacity,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
      rotate: degrees(rotation),
    });
    if (style === 'double') {
      page.drawRectangle({
        x: rect.x + inset,
        y: rect.y + inset,
        width: Math.max(2, rect.width - inset * 2),
        height: Math.max(2, rect.height - inset * 2),
        borderColor: color,
        borderOpacity: Math.min(0.8, opacity),
        borderWidth: Math.max(0.8, borderWidth * 0.45),
        rotate: degrees(rotation),
      });
    }
  }

  const label = safePdfText((text || 'APPROVED').toUpperCase()).slice(0, 34);
  const small = safePdfText((detail || 'VERIFIED').toUpperCase()).slice(0, 36);
  const labelFont = boldFont;
  const detailFont = regularFont ?? boldFont;
  const labelSize = Math.max(
    10,
    Math.min(
      34,
      rect.height * (shape === 'seal' ? 0.24 : 0.32),
      (rect.width / Math.max(4, label.length)) * 1.65,
    ),
  );
  const detailSize = Math.max(
    6,
    Math.min(12, rect.height * 0.14, (rect.width / Math.max(6, small.length)) * 1.45),
  );
  const labelWidth = labelFont?.widthOfTextAtSize(label, labelSize) ?? label.length * labelSize * 0.55;
  const detailWidth = detailFont?.widthOfTextAtSize(small, detailSize) ?? small.length * detailSize * 0.5;
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  page.drawText(label, {
    x: centerX - labelWidth / 2,
    y: centerY - labelSize * 0.22,
    size: labelSize,
    font: labelFont,
    color,
    opacity,
    rotate: degrees(rotation),
    maxWidth: rect.width - inset * 2,
  });
  if (small) {
    page.drawText(small, {
      x: centerX - detailWidth / 2,
      y: centerY - labelSize * 0.82,
      size: detailSize,
      font: detailFont,
      color,
      opacity: Math.min(0.82, opacity),
      rotate: degrees(rotation),
      maxWidth: rect.width - inset * 2,
    });
  }
}

export function drawSignature(
  page: PDFPage,
  text: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  rotation: number,
) {
  const rect = pageRect(page, 0.42, 0.7, 0.34, 0.1);
  page.drawText(safePdfText(text || 'Signature'), {
    x: rect.x,
    y: rect.y + rect.height * 0.28,
    size: Math.max(18, Math.min(32, rect.height * 0.45)),
    color,
    opacity,
    rotate: degrees(rotation),
  });
  page.drawLine({
    start: { x: rect.x, y: rect.y + rect.height * 0.18 },
    end: { x: rect.x + rect.width, y: rect.y + rect.height * 0.18 },
    color,
    opacity: Math.min(0.65, opacity),
    thickness: 1,
  });
}

export function drawWatermark(
  page: PDFPage,
  text: string,
  color: ReturnType<typeof rgb>,
  opacity: number,
  rotation: number,
) {
  const size = page.getSize();
  const clean = safePdfText(text || 'CONFIDENTIAL');
  const fontSize = Math.min(64, Math.max(30, (size.width / Math.max(5, clean.length)) * 1.6));
  page.drawText(clean, {
    x: size.width * 0.18,
    y: size.height * 0.46,
    size: fontSize,
    color,
    opacity,
    rotate: degrees(rotation),
  });
}

export function drawAnnotation(page: PDFPage, text: string, color: ReturnType<typeof rgb>, opacity: number) {
  const rect = pageRect(page, 0.62, 0.18, 0.28, 0.12);
  page.drawRectangle({
    ...rect,
    color: rgb(1, 0.96, 0.55),
    opacity: Math.min(0.92, Math.max(0.25, opacity)),
    borderColor: color,
    borderWidth: 1.4,
  });
  page.drawText(safePdfText(text || 'Review note'), {
    x: rect.x + 8,
    y: rect.y + rect.height - 18,
    size: 10,
    color: rgb(0.08, 0.08, 0.06),
    maxWidth: rect.width - 16,
  });
}

export function drawFormField(
  page: PDFPage,
  rect: ReturnType<typeof pageRect>,
  object: PdfEditorObjectExport,
  color: ReturnType<typeof rgb>,
  opacity: number,
  font: PDFFont,
  boldFont: PDFFont,
) {
  const kind = object.formFieldKind ?? 'text';
  const label = safePdfText(object.formPlaceholder ?? '');
  const value = safePdfText(object.formValue ?? '');
  const borderWidth = Math.max(0.8, Math.min(3, object.thickness ?? 1.4));

  if (kind === 'checkbox') {
    const boxSize = Math.min(rect.height, rect.width, 22);
    const box = { x: rect.x, y: rect.y + (rect.height - boxSize) / 2, width: boxSize, height: boxSize };
    page.drawRectangle({
      ...box,
      color,
      opacity: object.formChecked ? Math.min(0.18, opacity * 0.22) : 0,
      borderColor: color,
      borderOpacity: opacity,
      borderWidth,
    });
    if (object.formChecked) {
      page.drawLine({
        start: { x: box.x + boxSize * 0.22, y: box.y + boxSize * 0.52 },
        end: { x: box.x + boxSize * 0.42, y: box.y + boxSize * 0.28 },
        color,
        opacity,
        thickness: Math.max(1.4, borderWidth),
        lineCap: LineCapStyle.Round,
      });
      page.drawLine({
        start: { x: box.x + boxSize * 0.42, y: box.y + boxSize * 0.28 },
        end: { x: box.x + boxSize * 0.78, y: box.y + boxSize * 0.72 },
        color,
        opacity,
        thickness: Math.max(1.4, borderWidth),
        lineCap: LineCapStyle.Round,
      });
    }
    if (label) {
      page.drawText(label, {
        x: rect.x + boxSize + 8,
        y: rect.y + rect.height / 2 - 4,
        size: Math.max(7, Math.min(12, rect.height * 0.34)),
        font,
        color,
        opacity,
        maxWidth: Math.max(10, rect.width - boxSize - 10),
      });
    }
    return;
  }

  page.drawRectangle({
    ...rect,
    color: rgb(1, 1, 1),
    opacity: Math.min(0.12, opacity * 0.14),
    borderColor: color,
    borderOpacity: opacity,
    borderWidth,
  });

  if (kind === 'signature') {
    const signature = value || safePdfText('Signature');
    page.drawText(signature, {
      x: rect.x + 8,
      y: rect.y + rect.height * 0.45,
      size: Math.max(10, Math.min(24, object.fontSize ?? rect.height * 0.32)),
      font,
      color,
      opacity,
      maxWidth: Math.max(16, rect.width - 16),
    });
    page.drawLine({
      start: { x: rect.x + 8, y: rect.y + rect.height * 0.28 },
      end: { x: rect.x + rect.width - 8, y: rect.y + rect.height * 0.28 },
      color,
      opacity: Math.min(0.7, opacity),
      thickness: 1.2,
    });
    return;
  }

  if (label || object.formRequired) {
    const topLabel = `${label || (kind === 'date' ? 'Date' : kind === 'initials' ? 'Initials' : 'Field')}${object.formRequired ? ' *' : ''}`;
    page.drawText(safePdfText(topLabel), {
      x: rect.x + 6,
      y: rect.y + rect.height - Math.max(8, Math.min(11, rect.height * 0.24)) - 3,
      size: Math.max(6, Math.min(9, rect.height * 0.2)),
      font: boldFont,
      color,
      opacity: Math.min(0.82, opacity),
      maxWidth: Math.max(16, rect.width - 12),
    });
  }

  const printable = value || (kind === 'date' ? 'YYYY-MM-DD' : kind === 'initials' ? 'Initials' : '');
  if (printable) {
    page.drawText(safePdfText(printable), {
      x: rect.x + 6,
      y: rect.y + Math.max(5, rect.height * 0.24),
      size: Math.max(7, Math.min(18, object.fontSize ?? rect.height * 0.28)),
      font,
      color: value ? rgb(0.05, 0.06, 0.1) : color,
      opacity: value ? 1 : Math.min(0.62, opacity),
      maxWidth: Math.max(16, rect.width - 12),
    });
  }
}

export function drawRedactionPreview(page: PDFPage, label: string, color: ReturnType<typeof rgb>) {
  const rect = pageRect(page, 0.22, 0.42, 0.48, 0.07);
  page.drawRectangle({ ...rect, color, opacity: 1 });
  const text = safePdfText(label || 'Redacted');
  if (text) {
    page.drawText(text, {
      x: rect.x + 8,
      y: rect.y + rect.height / 2 - 4,
      size: 9,
      color: rgb(1, 1, 1),
      maxWidth: rect.width - 16,
    });
  }
}
