import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';

import { applyPdfEditorObjects, applyPdfEditorTool, type PdfEditorTool } from './pdf';

const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlXIAAAAASUVORK5CYII=';

async function sourcePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([600, 800]);
  document.addPage([500, 700]);
  return document.save();
}

describe('PDF editor application', () => {
  it('applies every toolbar operation to valid vector pages', async () => {
    const tools: PdfEditorTool[] = [
      'doodle',
      'highlight',
      'add-stamp',
      'add-signature',
      'flatten',
      'add-watermark',
      'annotate',
      'redact',
      'add-text',
      'add-page-numbers',
      'fill-forms',
    ];

    for (const tool of tools) {
      const output = await applyPdfEditorTool(await sourcePdf(), {
        tool,
        targetPages: [-1, 0, 0, 99],
        text: 'FileMint ✓',
        stampText: 'APPROVED',
        signatureText: 'A. User',
        annotationText: 'Review this page',
        redactLabel: 'Removed',
        color: '#12AABB',
        opacity: 4,
        thickness: -3,
        rotation: Number.NaN,
      });
      const document = await PDFDocument.load(output);
      expect(document.getPageCount()).toBe(2);
      expect(output.byteLength).toBeGreaterThan(100);
    }
  });

  it('renders positioned object variants and ignores invalid page indices', async () => {
    const output = await applyPdfEditorObjects(await sourcePdf(), [
      {
        type: 'doodle',
        pageIndex: 0,
        doodleMode: 'arrow',
        points: [
          { x: 0.1, y: 0.1 },
          { x: 0.8, y: 0.8 },
        ],
      },
      {
        type: 'doodle',
        pageIndex: 0,
        doodleMode: 'pencil',
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.3, y: 0.5 },
        ],
      },
      { type: 'highlight', pageIndex: 0, x: 0.1, y: 0.1, width: 0.5, height: 0.08 },
      { type: 'redact', pageIndex: 0, text: 'Private', x: 0.2, y: 0.2, width: 0.4, height: 0.1 },
      { type: 'annotate', pageIndex: 0, annotationMode: 'shape', x: 0.1, y: 0.4, width: 0.3, height: 0.15 },
      {
        type: 'annotate',
        pageIndex: 1,
        annotationMode: 'callout',
        text: 'Note',
        x: 0.2,
        y: 0.2,
        width: 0.3,
        height: 0.2,
      },
      {
        type: 'stamp',
        pageIndex: 0,
        text: 'PAID',
        stampDetail: '2026',
        stampShape: 'seal',
        stampStyle: 'filled',
      },
      { type: 'signature', pageIndex: 0, signatureMode: 'type', text: 'A. User' },
      {
        type: 'signature',
        pageIndex: 1,
        signatureMode: 'draw',
        signaturePaths: [
          [
            { x: 0.1, y: 0.4 },
            { x: 0.4, y: 0.2 },
            { x: 0.8, y: 0.5 },
          ],
        ],
      },
      { type: 'watermark', pageIndex: 1, text: 'DRAFT', rotation: -30 },
      {
        type: 'text',
        pageIndex: 1,
        text: 'Editable',
        bold: true,
        italic: true,
        underline: true,
        align: 'center',
      },
      {
        type: 'form-field',
        pageIndex: 0,
        formFieldKind: 'checkbox',
        formChecked: true,
        formPlaceholder: 'Agree',
      },
      { type: 'form-field', pageIndex: 1, formFieldKind: 'signature', formValue: 'A. User' },
      { type: 'text', pageIndex: 20, text: 'Ignored' },
    ]);

    const document = await PDFDocument.load(output);
    expect(document.getPageCount()).toBe(2);
    expect(document.getCreator()).toBe('FileMint');
  });

  it('returns the original bytes when there are no positioned objects', async () => {
    const source = await sourcePdf();
    await expect(applyPdfEditorObjects(source, [])).resolves.toBe(source);
  });

  it('rejects unsupported uploaded object images clearly', async () => {
    await expect(
      applyPdfEditorObjects(await sourcePdf(), [
        {
          type: 'stamp',
          pageIndex: 0,
          stampMode: 'upload',
          stampImageDataUrl: 'data:image/gif;base64,R0lGODlh',
        },
      ]),
    ).rejects.toThrow('Uploaded stamps must be PNG or JPG images.');
  });

  it('applies toolbar defaults when optional editor values are omitted', async () => {
    const tools: PdfEditorTool[] = [
      'doodle',
      'highlight',
      'add-stamp',
      'add-signature',
      'add-watermark',
      'annotate',
      'redact',
      'add-text',
      'add-page-numbers',
      'fill-forms',
    ];

    for (const tool of tools) {
      const output = await applyPdfEditorTool(await sourcePdf(), { tool, targetPages: [] });
      expect((await PDFDocument.load(output)).getPageCount()).toBe(2);
    }
  });

  it('covers image uploads, signature fallbacks, and every text font style', async () => {
    const output = await applyPdfEditorObjects(await sourcePdf(), [
      {
        type: 'doodle',
        pageIndex: 0,
        doodleMode: 'vector',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.6, y: 0.7 },
        ],
      },
      { type: 'doodle', pageIndex: 0, doodleMode: 'pencil' },
      { type: 'redact', pageIndex: 0, text: '' },
      { type: 'annotate', pageIndex: 0 },
      {
        type: 'stamp',
        pageIndex: 0,
        stampMode: 'upload',
        stampImageDataUrl: ONE_PIXEL_PNG_DATA_URL,
        rotation: 15,
      },
      {
        type: 'signature',
        pageIndex: 0,
        signatureMode: 'upload',
        signatureImageDataUrl: ONE_PIXEL_PNG_DATA_URL,
      },
      {
        type: 'signature',
        pageIndex: 0,
        signatureMode: 'draw',
        signaturePoints: [
          { x: 0.1, y: 0.4 },
          { x: 0.8, y: 0.5 },
        ],
      },
      { type: 'signature', pageIndex: 0, signatureMode: 'draw' },
      { type: 'signature', pageIndex: 0, signatureMode: 'type' },
      { type: 'watermark', pageIndex: 1 },
      { type: 'text', pageIndex: 1, bold: true },
      { type: 'text', pageIndex: 1, italic: true, align: 'right' },
      { type: 'text', pageIndex: 1 },
    ]);

    const document = await PDFDocument.load(output);
    expect(document.getPageCount()).toBe(2);
    expect(document.getCreator()).toBe('FileMint');
  });

  it('reports malformed and unsupported signature uploads precisely', async () => {
    await expect(
      applyPdfEditorObjects(await sourcePdf(), [
        { type: 'signature', pageIndex: 0, signatureMode: 'upload', signatureImageDataUrl: 'invalid' },
      ]),
    ).rejects.toThrow('Could not read the uploaded signature image.');

    await expect(
      applyPdfEditorObjects(await sourcePdf(), [
        {
          type: 'signature',
          pageIndex: 0,
          signatureMode: 'upload',
          signatureImageDataUrl: 'data:image/gif;base64,R0lGODlh',
        },
      ]),
    ).rejects.toThrow('Uploaded signatures must be PNG or JPG images.');

    await expect(
      applyPdfEditorObjects(await sourcePdf(), [
        { type: 'stamp', pageIndex: 0, stampMode: 'upload', stampImageDataUrl: 'invalid' },
      ]),
    ).rejects.toThrow('Could not read the uploaded stamp image.');
  });
});
