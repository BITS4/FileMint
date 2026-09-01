/** Applies editor tools and positioned objects to PDF content streams. */
import { StandardFonts, degrees, rgb } from 'pdf-lib';

import { load } from './pdf-core';
import {
  colorFromHex,
  drawDoodle,
  drawPdfArrowHead,
  drawPdfDoodlePath,
  drawPdfLine,
  drawPdfSignaturePaths,
  drawTextLines,
  pageObjectRect,
  pagePoint,
  pageRect,
  parseImageDataUrl,
  safePdfText,
  validTargets,
} from './pdf-editor.geometry';
import {
  drawAnnotation,
  drawFormField,
  drawPremiumStamp,
  drawRedactionPreview,
  drawSignature,
  drawStamp,
  drawWatermark,
} from './pdf-editor.objects';
import type { PdfEditorExportOptions, PdfEditorObjectExport } from './pdf-editor.types';

/**
 * Applies real PDF edits on top of the original vector/text pages. These edits
 * are drawn into the PDF content stream; the page itself is not rasterized.
 * Redaction here is a visual fallback only. Production redaction uses the
 * server-side PyMuPDF route so hidden text is removed.
 */
export async function applyPdfEditorTool(
  bytes: Uint8Array,
  opts: PdfEditorExportOptions,
): Promise<Uint8Array> {
  const doc = await load(bytes);
  const targets = validTargets(doc, opts.targetPages);
  const color = colorFromHex(opts.color, opts.tool === 'redact' ? '#000000' : '#2BD9A8');
  const opacity = Math.max(0.05, Math.min(1, opts.opacity ?? 0.86));
  const thickness = Math.max(1, Math.min(18, opts.thickness ?? 4));
  const rotation = Number.isFinite(opts.rotation ?? 0) ? (opts.rotation ?? 0) : 0;
  const pageNumberFont =
    opts.tool === 'add-page-numbers' ? await doc.embedFont(StandardFonts.Helvetica) : null;

  if (opts.tool === 'flatten') {
    try {
      doc.getForm().flatten();
    } catch {
      // No AcroForm fields. Saving still normalizes object streams.
    }
    doc.setProducer('FileMint');
    doc.setCreator('FileMint');
    return doc.save({ useObjectStreams: true });
  }

  for (const index of targets) {
    const page = doc.getPage(index);
    if (opts.tool === 'doodle') drawDoodle(page, color, opacity, thickness);
    if (opts.tool === 'highlight') {
      const rect = pageRect(page, 0.18, 0.36, 0.56, 0.052);
      page.drawRectangle({
        ...rect,
        color: colorFromHex(opts.color, '#F7C948'),
        opacity: Math.min(0.55, opacity),
      });
      page.drawLine({
        start: { x: rect.x, y: rect.y - 3 },
        end: { x: rect.x + rect.width, y: rect.y - 3 },
        color: colorFromHex(opts.color, '#F7C948'),
        opacity,
        thickness: 1.6,
      });
    }
    if (opts.tool === 'add-stamp')
      drawStamp(page, opts.stampText ?? opts.text ?? 'APPROVED', color, opacity, rotation || -12);
    if (opts.tool === 'add-signature')
      drawSignature(page, opts.signatureText ?? opts.text ?? 'Signature', color, opacity, rotation || -8);
    if (opts.tool === 'add-watermark')
      drawWatermark(page, opts.text ?? 'CONFIDENTIAL', color, Math.min(0.55, opacity), rotation || -34);
    if (opts.tool === 'annotate')
      drawAnnotation(page, opts.annotationText ?? opts.text ?? 'Review note', color, opacity);
    if (opts.tool === 'redact')
      drawRedactionPreview(page, opts.redactLabel ?? 'Redacted', colorFromHex(opts.color, '#000000'));
    if (opts.tool === 'add-text') {
      const rect = pageRect(page, 0.19, 0.3, 0.44, 0.08);
      page.drawText(safePdfText(opts.text ?? 'Editable text'), {
        x: rect.x,
        y: rect.y + rect.height / 2,
        size: 14,
        color,
        opacity,
      });
    }
    if (opts.tool === 'add-page-numbers' && pageNumberFont) {
      const size = page.getSize();
      const label = `${index + 1}`;
      const fontSize = 11;
      const textWidth = pageNumberFont.widthOfTextAtSize(label, fontSize);
      page.drawText(label, {
        x: (size.width - textWidth) / 2,
        y: 28,
        size: fontSize,
        font: pageNumberFont,
        color: rgb(0.24, 0.27, 0.31),
      });
    }
  }

  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}

export async function applyPdfEditorObjects(
  bytes: Uint8Array,
  objects: PdfEditorObjectExport[],
): Promise<Uint8Array> {
  if (!objects.length) return bytes;
  const doc = await load(bytes);
  const regularFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await doc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalicFont = await doc.embedFont(StandardFonts.HelveticaBoldOblique);
  const signatureFont = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const maxPage = doc.getPageCount() - 1;

  for (const object of objects) {
    if (!Number.isInteger(object.pageIndex) || object.pageIndex < 0 || object.pageIndex > maxPage) continue;
    const page = doc.getPage(object.pageIndex);
    const color = colorFromHex(
      object.color,
      object.type === 'redact' ? '#000000' : object.type === 'highlight' ? '#F7C948' : '#2BD9A8',
    );
    const opacity = Math.max(0.05, Math.min(1, object.opacity ?? 0.86));
    const thickness = Math.max(1, Math.min(24, object.thickness ?? 4));
    const rotation = Number.isFinite(object.rotation ?? 0) ? (object.rotation ?? 0) : 0;

    if (object.type === 'doodle') {
      const points = object.points ?? [];
      if ((object.doodleMode === 'vector' || object.doodleMode === 'arrow') && points.length > 1) {
        const start = pagePoint(page, points[0]);
        const end = pagePoint(page, points[points.length - 1]);
        drawPdfLine(page, start, end, color, opacity, thickness);
        if (object.doodleMode === 'arrow') drawPdfArrowHead(page, start, end, color, opacity, thickness);
      } else {
        drawPdfDoodlePath(page, points, color, opacity, thickness);
      }
      continue;
    }

    const rect = pageObjectRect(page, object);
    if (object.type === 'highlight') {
      page.drawRectangle({
        ...rect,
        color,
        opacity: Math.min(0.58, opacity),
        borderColor: color,
        borderOpacity: Math.min(0.9, opacity),
        borderWidth: 0.8,
      });
      continue;
    }

    if (object.type === 'redact') {
      page.drawRectangle({ ...rect, color: rgb(0, 0, 0), opacity: 1 });
      const label = safePdfText(object.text ?? 'Redacted');
      if (label) {
        page.drawText(label, {
          x: rect.x + 8,
          y: rect.y + rect.height / 2 - 4,
          size: Math.max(7, Math.min(12, rect.height * 0.28)),
          font: boldFont,
          color: rgb(1, 1, 1),
          maxWidth: rect.width - 16,
        });
      }
      continue;
    }

    if (object.type === 'form-field') {
      drawFormField(page, rect, object, color, opacity, regularFont, boldFont);
      continue;
    }

    if (object.type === 'annotate') {
      if (object.annotationMode === 'shape') {
        page.drawRectangle({
          ...rect,
          color: rgb(1, 1, 1),
          opacity: 0,
          borderColor: color,
          borderOpacity: opacity,
          borderWidth: Math.max(1.5, thickness * 0.65),
        });
        continue;
      }
      page.drawRectangle({
        ...rect,
        color: rgb(1, 0.96, 0.55),
        opacity: Math.min(0.92, opacity),
        borderColor: color,
        borderOpacity: opacity,
        borderWidth: 1.2,
      });
      drawTextLines(
        page,
        object.text ?? 'Review note',
        rect,
        regularFont,
        Math.max(8, Math.min(13, rect.height * 0.16)),
        rgb(0.08, 0.08, 0.06),
        1,
      );
      if (object.annotationMode === 'callout') {
        page.drawLine({
          start: { x: rect.x + rect.width * 0.16, y: rect.y },
          end: { x: Math.max(0, rect.x - rect.width * 0.16), y: Math.max(0, rect.y - rect.height * 0.22) },
          color,
          opacity,
          thickness: Math.max(1, thickness * 0.35),
        });
      }
      continue;
    }

    if (object.type === 'stamp') {
      if (object.stampMode === 'upload' && object.stampImageDataUrl) {
        const image = parseImageDataUrl(object.stampImageDataUrl);
        if (!image) throw new Error('Could not read the uploaded stamp image.');
        const embedded = image.mime.includes('png')
          ? await doc.embedPng(image.bytes)
          : image.mime.includes('jpeg') || image.mime.includes('jpg')
            ? await doc.embedJpg(image.bytes)
            : null;
        if (!embedded) throw new Error('Uploaded stamps must be PNG or JPG images.');
        page.drawImage(embedded, {
          ...rect,
          opacity,
          rotate: degrees(rotation),
        });
        continue;
      }
      drawPremiumStamp(
        page,
        rect,
        object.text ?? 'APPROVED',
        object.stampDetail ?? 'VERIFIED',
        color,
        opacity,
        thickness,
        rotation,
        object.stampShape ?? 'box',
        object.stampStyle ?? 'double',
        boldFont,
        regularFont,
      );
      continue;
    }

    if (object.type === 'signature') {
      if (object.signatureMode === 'draw') {
        const paths = object.signaturePaths?.length
          ? object.signaturePaths
          : object.signaturePoints?.length
            ? [object.signaturePoints]
            : [];
        drawPdfSignaturePaths(page, rect, paths, color, opacity, thickness, rotation);
        continue;
      }
      if (object.signatureMode === 'upload' && object.signatureImageDataUrl) {
        const image = parseImageDataUrl(object.signatureImageDataUrl);
        if (!image) throw new Error('Could not read the uploaded signature image.');
        const embedded = image.mime.includes('png')
          ? await doc.embedPng(image.bytes)
          : image.mime.includes('jpeg') || image.mime.includes('jpg')
            ? await doc.embedJpg(image.bytes)
            : null;
        if (!embedded) throw new Error('Uploaded signatures must be PNG or JPG images.');
        page.drawImage(embedded, {
          ...rect,
          opacity,
          rotate: degrees(rotation),
        });
        continue;
      }
      page.drawText(safePdfText(object.text ?? 'Signature'), {
        x: rect.x + 4,
        y: rect.y + rect.height * 0.35,
        size: Math.max(8, Math.min(96, object.fontSize ?? Math.max(13, Math.min(38, rect.height * 0.44)))),
        font: signatureFont,
        color,
        opacity,
        rotate: degrees(rotation),
        maxWidth: Math.max(16, rect.width - 8),
      });
      page.drawLine({
        start: { x: rect.x, y: rect.y + rect.height * 0.2 },
        end: { x: rect.x + rect.width, y: rect.y + rect.height * 0.2 },
        color,
        opacity: Math.min(0.65, opacity),
        thickness: 1,
      });
      continue;
    }

    if (object.type === 'watermark') {
      page.drawText(safePdfText(object.text ?? 'CONFIDENTIAL'), {
        x: rect.x,
        y: rect.y + rect.height * 0.32,
        size: Math.max(22, Math.min(68, rect.height * 0.46)),
        font: boldFont,
        color,
        opacity: Math.min(0.6, opacity),
        rotate: degrees(rotation),
        maxWidth: Math.max(16, rect.width),
      });
      continue;
    }

    if (object.type === 'text') {
      const textFont =
        object.bold && object.italic
          ? boldItalicFont
          : object.bold
            ? boldFont
            : object.italic
              ? italicFont
              : regularFont;
      drawTextLines(
        page,
        object.text ?? 'Editable text',
        rect,
        textFont,
        Math.max(6, Math.min(96, object.fontSize ?? Math.max(8, Math.min(22, rect.height * 0.24)))),
        color,
        opacity,
        object.align ?? 'left',
        Boolean(object.underline),
      );
    }
  }

  doc.setProducer('FileMint');
  doc.setCreator('FileMint');
  return doc.save({ useObjectStreams: true });
}
