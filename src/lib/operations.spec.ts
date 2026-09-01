import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolOperation } from './operations.helpers';
import type { FileItem } from '@/types';

const mocks = vi.hoisted(() => ({
  addPageNumbers: vi.fn(async () => new Uint8Array([2])),
  addWatermark: vi.fn(async () => new Uint8Array([3])),
  backendConvert: vi.fn(async (..._args: unknown[]) => ({ id: 'server-result' })),
  backendPdfText: vi.fn(async () => ({ id: 'text-fallback' })),
  cropPdf: vi.fn(async () => new Uint8Array([4])),
  csvRowsToPdf: vi.fn(async () => new Uint8Array([5])),
  extractPdfText: vi.fn(async () => 'extracted text'),
  flattenForms: vi.fn(async () => new Uint8Array([6])),
  officeToPdf: vi.fn(() => ({ mode: 'process' as const })),
  pdfExportTo: vi.fn(() => ({ mode: 'process' as const })),
  pdfToImages: vi.fn(() => ({ mode: 'process' as const })),
  readBytes: vi.fn(async () => new Uint8Array([1])),
  save: vi.fn(async (input: Record<string, unknown>) => ({ id: 'saved', ...input })),
  textToPdf: vi.fn(async () => new Uint8Array([7])),
}));

vi.mock('@/lib/pdf', () => ({
  addPageNumbers: mocks.addPageNumbers,
  addWatermark: mocks.addWatermark,
  cropPdf: mocks.cropPdf,
  csvRowsToPdf: mocks.csvRowsToPdf,
  flattenForms: mocks.flattenForms,
  textToPdf: mocks.textToPdf,
}));
vi.mock('@/lib/pdf-render', () => ({ extractPdfText: mocks.extractPdfText }));
vi.mock('@/lib/storage', () => ({ readBytes: mocks.readBytes }));
vi.mock('@/store/useSettings', () => ({
  useSettings: { getState: () => ({ ocrLanguage: 'eng' }) },
}));
vi.mock('./operations.helpers', () => ({
  OCR_LANGUAGE_FIELD: { key: 'language', label: 'Language', type: 'select', default: 'auto' },
  WM_COLORS: {
    blue: { r: 0, g: 0, b: 1 },
    gray: { r: 0.5, g: 0.5, b: 0.5 },
  },
  backendConvert: mocks.backendConvert,
  backendPdfText: mocks.backendPdfText,
  officeToPdf: mocks.officeToPdf,
  pdfExportTo: mocks.pdfExportTo,
  pdfToImages: mocks.pdfToImages,
  save: mocks.save,
}));

const sourceFile: FileItem = {
  id: 'source',
  name: 'Quarterly.Report.pdf',
  kind: 'pdf',
  ext: 'pdf',
  mime: 'application/pdf',
  size: 100,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: 'documents/source.pdf',
  source: 'import',
};

let getOperation: (id: string) => ToolOperation | null;

function context(values: Record<string, string | boolean> = {}) {
  return { file: sourceFile, values, onProgress: vi.fn() };
}

describe('operation registry', () => {
  beforeAll(async () => {
    ({ getOperation } = await import('./operations'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBytes.mockResolvedValue(new Uint8Array([1]));
    mocks.extractPdfText.mockResolvedValue('extracted text');
  });

  it('returns registered operations and rejects unknown ids', () => {
    expect(getOperation('txt-to-pdf')).toMatchObject({ mode: 'compose' });
    expect(getOperation('open-pdf')).toMatchObject({ mode: 'open' });
    expect(getOperation('docx-to-pdf')).toMatchObject({ mode: 'process' });
    expect(getOperation('pdf-to-pptx')).toMatchObject({ mode: 'process' });
    expect(getOperation('pdf-to-jpg')).toMatchObject({ mode: 'process' });
    expect(getOperation('missing')).toBeNull();
  });

  it('validates and creates a PDF from entered text', async () => {
    await expect(getOperation('txt-to-pdf')!.run!(context({ content: '   ' }))).rejects.toThrow(
      'Enter some text',
    );

    const ctx = context({ content: 'Hello FileMint', name: 'Memo' });
    await getOperation('txt-to-pdf')!.run!(ctx);

    expect(ctx.onProgress).toHaveBeenCalledWith(0.4);
    expect(mocks.textToPdf).toHaveBeenCalledWith('Hello FileMint', { title: 'Memo' });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Memo.pdf', source: 'created' }));
  });

  it('parses CSV data and rejects an empty document', async () => {
    mocks.readBytes.mockResolvedValueOnce(new TextEncoder().encode('name,total\nTea,4'));
    await getOperation('csv-to-pdf')!.run!(context());
    expect(mocks.csvRowsToPdf).toHaveBeenCalledWith(
      [
        ['name', 'total'],
        ['Tea', '4'],
      ],
      'Quarterly.Report',
    );

    mocks.readBytes.mockResolvedValueOnce(new Uint8Array());
    await expect(getOperation('csv-to-pdf')!.run!(context())).rejects.toThrow('No CSV rows');
  });

  it.each([
    ['add-watermark', mocks.addWatermark, { text: 'DRAFT', color: 'blue', opacity: '0.3' }],
    ['add-page-numbers', mocks.addPageNumbers, { position: 'top-right', startAt: '4' }],
    ['flatten', mocks.flattenForms, {}],
    ['crop-pdf', mocks.cropPdf, { margin: '18' }],
  ])('runs the %s client-side PDF operation', async (id, transform, values) => {
    const ctx = context(values);
    await getOperation(id)!.run!(ctx);

    expect(mocks.readBytes).toHaveBeenCalledWith(sourceFile.storageKey);
    expect(transform).toHaveBeenCalled();
    expect(ctx.onProgress).toHaveBeenCalledWith(0.4);
    expect(mocks.save).toHaveBeenCalled();
  });

  it('extracts PDF text locally and falls back to the server when needed', async () => {
    const ctx = context();
    await getOperation('pdf-to-text')!.run!(ctx);
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Quarterly.Report.txt', mime: 'text/plain' }),
    );
    expect(mocks.backendPdfText).not.toHaveBeenCalled();

    mocks.extractPdfText.mockRejectedValueOnce(new Error('renderer unavailable'));
    await getOperation('pdf-to-text')!.run!(ctx);
    expect(mocks.backendPdfText).toHaveBeenCalledWith(sourceFile, ctx.onProgress);

    mocks.extractPdfText.mockResolvedValueOnce('  ');
    await getOperation('pdf-to-text')!.run!(ctx);
    expect(mocks.backendPdfText).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['lock-pdf', 'Enter a password.'],
    ['unlock-pdf', 'Enter the current password.'],
    ['pdf-permissions', 'Enter an owner password.'],
  ])('requires credentials for %s', (id, message) => {
    expect(() => getOperation(id)!.run!(context())).toThrow(message);
    expect(mocks.backendConvert).not.toHaveBeenCalled();
  });

  it('maps conversion, OCR, security, and repair options to server requests', async () => {
    const progress = vi.fn();
    await getOperation('pdf-to-docx')!.run!({
      file: sourceFile,
      onProgress: progress,
      values: {
        autoDetectLanguage: true,
        keepVisualObjects: true,
        preserveLayout: true,
        tableDetection: true,
      },
    });
    expect(mocks.backendConvert).toHaveBeenLastCalledWith(
      sourceFile,
      'convert',
      expect.objectContaining({ language: 'auto', mode: 'hybrid', target: 'docx' }),
      'docx',
      progress,
    );

    await getOperation('pdf-to-searchable')!.run!({ file: sourceFile, onProgress: progress, values: {} });
    expect(mocks.backendConvert).toHaveBeenLastCalledWith(
      sourceFile,
      'ocr',
      expect.objectContaining({ deskew: true, language: 'auto', rotatePages: true }),
      'pdf',
      progress,
      'searchable',
    );

    await getOperation('lock-pdf')!.run!(context({ password: 'safe passphrase' }));
    await getOperation('unlock-pdf')!.run!(context({ password: 'safe passphrase' }));
    await getOperation('pdf-permissions')!.run!(
      context({ allowCopy: false, allowPrint: true, ownerPassword: 'owner passphrase' }),
    );
    await getOperation('repair-pdf')!.run!(context());

    expect(mocks.backendConvert.mock.calls.map((call) => call[1])).toEqual(
      expect.arrayContaining(['secure/lock', 'secure/unlock', 'secure/permissions', 'repair']),
    );
  });
});
