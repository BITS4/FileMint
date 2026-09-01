import { rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';

import {
  drawAnnotation,
  drawFormField,
  drawPremiumStamp,
  drawRedactionPreview,
  drawSignature,
  drawStamp,
  drawWatermark,
} from './pdf-editor.objects';

function recordingPage(width = 600, height = 800) {
  const drawRectangle = vi.fn((..._args: Parameters<PDFPage['drawRectangle']>) => undefined);
  const drawEllipse = vi.fn((..._args: Parameters<PDFPage['drawEllipse']>) => undefined);
  const drawText = vi.fn((..._args: Parameters<PDFPage['drawText']>) => undefined);
  const drawLine = vi.fn((..._args: Parameters<PDFPage['drawLine']>) => undefined);
  const page = {
    getSize: () => ({ width, height }),
    drawRectangle,
    drawEllipse,
    drawText,
    drawLine,
  } as unknown as PDFPage;

  return { page, drawRectangle, drawEllipse, drawText, drawLine };
}

function recordingFont(widthFactor: number) {
  const widthOfTextAtSize = vi.fn((text: string, size: number) => text.length * size * widthFactor);
  return { font: { widthOfTextAtSize } as unknown as PDFFont, widthOfTextAtSize };
}

describe('PDF editor object renderers', () => {
  it('renders a default stamp at page-relative coordinates and sanitizes custom text', () => {
    const color = rgb(0.1, 0.4, 0.8);
    const defaults = recordingPage();
    drawStamp(defaults.page, '', color, 0.6, 12);

    expect(defaults.drawRectangle).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 144,
        y: 272,
        width: 288,
        height: 88,
        borderColor: color,
        borderOpacity: 0.6,
        borderWidth: 3,
      }),
    );
    expect(defaults.drawText).toHaveBeenCalledWith(
      'APPROVED',
      expect.objectContaining({ x: 162, y: 306, size: 33.44, color, opacity: 0.6 }),
    );

    const custom = recordingPage(200, 100);
    drawStamp(custom.page, 'Paid ✅', color, 1, 0);
    expect(custom.drawText).toHaveBeenCalledWith('Paid ?', expect.objectContaining({ size: 18 }));
  });

  it('renders double boxed stamps with bounded borders and measured, truncated labels', () => {
    const page = recordingPage();
    const bold = recordingFont(0.6);
    const regular = recordingFont(0.45);
    const color = rgb(0.7, 0.1, 0.1);
    const rect = { x: 10, y: 20, width: 160, height: 60 };

    drawPremiumStamp(
      page.page,
      rect,
      'a very long approved label that is truncated ✅',
      'a verification detail that is also deliberately truncated',
      color,
      0.95,
      20,
      -8,
      'box',
      'double',
      bold.font,
      regular.font,
    );

    expect(page.drawRectangle).toHaveBeenCalledTimes(2);
    expect(page.drawEllipse).not.toHaveBeenCalled();
    expect(page.drawRectangle).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ...rect, opacity: 0.035, borderWidth: 8, borderOpacity: 0.95 }),
    );
    expect(page.drawRectangle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ x: 24.4, y: 34.4, width: 131.2, height: 31.2, borderWidth: 3.6 }),
    );

    const label = page.drawText.mock.calls[0][0];
    const detail = page.drawText.mock.calls[1][0];
    expect(label).toHaveLength(34);
    expect(label).toBe(label.toUpperCase());
    expect(label).not.toContain('✅');
    expect(detail).toHaveLength(36);
    expect(bold.widthOfTextAtSize).toHaveBeenCalledWith(label, expect.any(Number));
    expect(regular.widthOfTextAtSize).toHaveBeenCalledWith(detail, expect.any(Number));
  });

  it('supports filled seals and clamps the inner ring of tiny double pills', () => {
    const color = rgb(0.2, 0.7, 0.3);
    const filled = recordingPage();
    drawPremiumStamp(
      filled.page,
      { x: 20, y: 30, width: 120, height: 80 },
      '',
      '',
      color,
      1,
      0,
      30,
      'seal',
      'filled',
    );

    expect(filled.drawEllipse).toHaveBeenCalledTimes(1);
    expect(filled.drawEllipse).toHaveBeenCalledWith(
      expect.objectContaining({ x: 80, y: 70, xScale: 60, yScale: 40, opacity: 0.22, borderWidth: 1.6 }),
    );
    expect(filled.drawText).toHaveBeenNthCalledWith(
      1,
      'APPROVED',
      expect.objectContaining({ font: undefined }),
    );
    expect(filled.drawText).toHaveBeenNthCalledWith(
      2,
      'VERIFIED',
      expect.objectContaining({ font: undefined, opacity: 0.82 }),
    );

    const tiny = recordingPage();
    drawPremiumStamp(
      tiny.page,
      { x: 3, y: 4, width: 10, height: 10 },
      'OK',
      'QA',
      color,
      0.4,
      1,
      0,
      'pill',
      'double',
    );
    expect(tiny.drawEllipse).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ xScale: 2, yScale: 2, borderOpacity: 0.4, borderWidth: 0.8 }),
    );
  });

  it('lays out signatures, watermarks, and annotations with bounded presentation values', () => {
    const color = rgb(0.3, 0.2, 0.7);
    const signature = recordingPage();
    drawSignature(signature.page, '', color, 0.9, 6);
    expect(signature.drawText).toHaveBeenCalledWith(
      'Signature',
      expect.objectContaining({ x: 252, y: expect.closeTo(182.4), size: 32, opacity: 0.9 }),
    );
    expect(signature.drawLine).toHaveBeenCalledWith(
      expect.objectContaining({
        start: { x: 252, y: expect.closeTo(174.4) },
        end: { x: 456, y: expect.closeTo(174.4) },
        opacity: 0.65,
      }),
    );

    const watermark = recordingPage(120, 240);
    drawWatermark(watermark.page, 'Private ✅', color, 0.3, -35);
    expect(watermark.drawText).toHaveBeenCalledWith(
      'Private ?',
      expect.objectContaining({ x: expect.closeTo(21.6), y: 110.4, size: 30, opacity: 0.3 }),
    );

    const faintNote = recordingPage();
    drawAnnotation(faintNote.page, '', color, 0.05);
    expect(faintNote.drawRectangle).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.25 }));
    expect(faintNote.drawText).toHaveBeenCalledWith('Review note', expect.objectContaining({ size: 10 }));

    const strongNote = recordingPage();
    drawAnnotation(strongNote.page, 'Ready', color, 4);
    expect(strongNote.drawRectangle).toHaveBeenCalledWith(expect.objectContaining({ opacity: 0.92 }));
  });

  it('draws checked and unchecked checkbox fields with optional labels', () => {
    const color = rgb(0.1, 0.2, 0.3);
    const regular = recordingFont(0.5).font;
    const bold = recordingFont(0.6).font;
    const checked = recordingPage();

    drawFormField(
      checked.page,
      { x: 10, y: 20, width: 100, height: 30 },
      {
        type: 'form-field',
        pageIndex: 0,
        formFieldKind: 'checkbox',
        formChecked: true,
        formPlaceholder: 'Accept terms',
        thickness: 10,
      },
      color,
      0.8,
      regular,
      bold,
    );

    expect(checked.drawRectangle).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 10,
        y: 24,
        width: 22,
        height: 22,
        opacity: expect.closeTo(0.176),
        borderWidth: 3,
      }),
    );
    expect(checked.drawLine).toHaveBeenCalledTimes(2);
    expect(checked.drawText).toHaveBeenCalledWith(
      'Accept terms',
      expect.objectContaining({ x: 40, maxWidth: 68, font: regular }),
    );

    const unchecked = recordingPage();
    drawFormField(
      unchecked.page,
      { x: 0, y: 0, width: 18, height: 12 },
      { type: 'form-field', pageIndex: 0, formFieldKind: 'checkbox', thickness: -4 },
      color,
      1,
      regular,
      bold,
    );
    expect(unchecked.drawRectangle).toHaveBeenCalledWith(
      expect.objectContaining({ width: 12, height: 12, opacity: 0, borderWidth: 0.8 }),
    );
    expect(unchecked.drawLine).not.toHaveBeenCalled();
    expect(unchecked.drawText).not.toHaveBeenCalled();
  });

  it('renders signature, required, date, initials, valued, and empty text form states', () => {
    const color = rgb(0.4, 0.1, 0.2);
    const regular = recordingFont(0.5).font;
    const bold = recordingFont(0.6).font;
    const rect = { x: 5, y: 8, width: 140, height: 40 };

    const signature = recordingPage();
    drawFormField(
      signature.page,
      rect,
      { type: 'form-field', pageIndex: 0, formFieldKind: 'signature', fontSize: 99 },
      color,
      0.9,
      regular,
      bold,
    );
    expect(signature.drawText).toHaveBeenCalledWith(
      'Signature',
      expect.objectContaining({ size: 24, font: regular, maxWidth: 124 }),
    );
    expect(signature.drawLine).toHaveBeenCalledWith(
      expect.objectContaining({ opacity: 0.7, thickness: 1.2 }),
    );

    const date = recordingPage();
    drawFormField(
      date.page,
      rect,
      { type: 'form-field', pageIndex: 0, formFieldKind: 'date', formRequired: true },
      color,
      0.5,
      regular,
      bold,
    );
    expect(date.drawText).toHaveBeenNthCalledWith(1, 'Date *', expect.objectContaining({ font: bold }));
    expect(date.drawText).toHaveBeenNthCalledWith(
      2,
      'YYYY-MM-DD',
      expect.objectContaining({ color, opacity: 0.5, font: regular }),
    );

    const initials = recordingPage();
    drawFormField(
      initials.page,
      rect,
      { type: 'form-field', pageIndex: 0, formFieldKind: 'initials', formRequired: true },
      color,
      0.9,
      regular,
      bold,
    );
    expect(initials.drawText).toHaveBeenNthCalledWith(1, 'Initials *', expect.any(Object));
    expect(initials.drawText).toHaveBeenNthCalledWith(
      2,
      'Initials',
      expect.objectContaining({ opacity: 0.62 }),
    );

    const valued = recordingPage();
    drawFormField(
      valued.page,
      rect,
      {
        type: 'form-field',
        pageIndex: 0,
        formValue: 'Ada Lovelace',
        formPlaceholder: 'Name',
        fontSize: 2,
      },
      color,
      0.2,
      regular,
      bold,
    );
    expect(valued.drawText).toHaveBeenNthCalledWith(1, 'Name', expect.objectContaining({ opacity: 0.2 }));
    expect(valued.drawText).toHaveBeenNthCalledWith(
      2,
      'Ada Lovelace',
      expect.objectContaining({ size: 7, opacity: 1 }),
    );

    const empty = recordingPage();
    drawFormField(empty.page, rect, { type: 'form-field', pageIndex: 0 }, color, 0.6, regular, bold);
    expect(empty.drawRectangle).toHaveBeenCalledTimes(1);
    expect(empty.drawText).not.toHaveBeenCalled();
  });

  it('draws an opaque redaction preview with a safe fallback label', () => {
    const color = rgb(0, 0, 0);
    const page = recordingPage();
    drawRedactionPreview(page.page, '', color);

    expect(page.drawRectangle).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 132,
        y: 408,
        width: 288,
        height: expect.closeTo(56),
        color,
        opacity: 1,
      }),
    );
    expect(page.drawText).toHaveBeenCalledWith(
      'Redacted',
      expect.objectContaining({ x: 140, y: 432, size: 9, maxWidth: 272 }),
    );
  });
});
