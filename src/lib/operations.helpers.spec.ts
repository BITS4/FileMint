import JSZip from 'jszip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/types';
import {
  backendConvert,
  backendPdfText,
  ensureServerCapability,
  officeToPdf,
  pdfExportTo,
  pdfToImages,
} from './operations.helpers';

const mocks = vi.hoisted(() => ({
  checkServer: vi.fn(),
  convertFile: vi.fn(),
  getServerBaseUrl: vi.fn(),
  getUri: vi.fn(),
  readBytes: vi.fn(),
  renderPdfToImages: vi.fn(),
  saveResult: vi.fn(),
  settings: { ocrLanguage: 'eng' },
}));

vi.mock('@/lib/api', () => ({
  checkServer: mocks.checkServer,
  convertFile: mocks.convertFile,
  getServerBaseUrl: mocks.getServerBaseUrl,
}));
vi.mock('@/lib/pdf-render', () => ({ renderPdfToImages: mocks.renderPdfToImages }));
vi.mock('@/lib/storage', () => ({ getUri: mocks.getUri, readBytes: mocks.readBytes }));
vi.mock('@/store/useLibrary', () => ({
  useLibrary: { getState: () => ({ saveResult: mocks.saveResult }) },
}));
vi.mock('@/store/useSettings', () => ({
  useSettings: { getState: () => mocks.settings },
}));

const source: FileItem = {
  id: 'source',
  name: 'Quarterly Report.pdf',
  kind: 'pdf',
  ext: 'pdf',
  mime: 'application/pdf',
  size: 4,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: 'source.pdf',
  source: 'import',
};

function status(online: boolean, enabled: Record<string, boolean> = {}) {
  return {
    online,
    capabilities: new Proxy(enabled, { get: (target, key) => target[String(key)] ?? false }),
  };
}

describe('operation execution helpers', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      if (typeof mock === 'function' && 'mockReset' in mock) (mock as ReturnType<typeof vi.fn>).mockReset();
    }
    mocks.settings.ocrLanguage = 'eng';
    mocks.getServerBaseUrl.mockReturnValue('http://localhost:8787');
    mocks.getUri.mockResolvedValue('file://source.pdf');
    mocks.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.saveResult.mockImplementation(async (input) => ({
      ...source,
      id: `saved-${mocks.saveResult.mock.calls.length}`,
      name: input.name,
      ext: input.ext,
      kind: input.kind ?? 'pdf',
      mime: input.mime,
      storageKey: input.name,
    }));
  });

  it('distinguishes an offline server from a missing runtime capability', async () => {
    mocks.checkServer.mockResolvedValueOnce(status(false)).mockResolvedValueOnce(status(true));

    await expect(ensureServerCapability('ocr', 'OCR')).rejects.toThrow(
      `Can't reach the conversion server at http://localhost:8787`,
    );
    await expect(ensureServerCapability('pdfExport', 'PDF export')).rejects.toThrow(
      'PDF export is not available on the server at http://localhost:8787',
    );

    mocks.checkServer.mockResolvedValue(status(true, { pdfExport: true }));
    await expect(ensureServerCapability('pdfExport', 'PDF export')).resolves.toBeUndefined();
  });

  it('converts through the backend with progress and a deterministic fallback name', async () => {
    const progress = vi.fn();
    mocks.convertFile.mockResolvedValue({
      bytes: new Uint8Array([9]),
      filename: 'result',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      report: { engine: 'pdf2docx' },
    });

    const result = await backendConvert(source, 'convert', { target: 'docx' }, 'docx', progress, 'editable');

    expect(mocks.convertFile).toHaveBeenCalledWith({
      endpoint: 'convert',
      fileUri: 'file://source.pdf',
      fileName: source.name,
      mime: source.mime,
      fields: { target: 'docx' },
    });
    expect(progress.mock.calls).toEqual([[0.15], [0.92]]);
    expect(mocks.saveResult).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Quarterly Report editable.docx',
        ext: 'docx',
        source: 'convert',
        conversionReport: { engine: 'pdf2docx' },
      }),
    );
    expect(result).toMatchObject({ name: 'Quarterly Report editable.docx' });
  });

  it('defines office-to-PDF behavior that delegates to the backend', async () => {
    mocks.convertFile.mockResolvedValue({
      bytes: new Uint8Array([7]),
      filename: 'Converted.pdf',
      mime: 'application/pdf',
    });
    const operation = officeToPdf(['word', 'excel'], ['application/docx']);
    const progress = vi.fn();

    expect(operation).toMatchObject({
      mode: 'process',
      libraryKinds: ['word', 'excel'],
      deviceTypes: ['application/docx'],
      serverCapability: 'libreoffice',
    });
    await operation.run?.({ file: source, values: {}, onProgress: progress });
    expect(mocks.convertFile).toHaveBeenCalledWith(expect.objectContaining({ fields: { target: 'pdf' } }));
  });

  it('renders PDF pages locally, saves each result, and reports proportional progress', async () => {
    mocks.renderPdfToImages.mockImplementation(async (_bytes, _format, _scale, progress) => {
      progress(0.5);
      return [
        { bytes: new Uint8Array([1]), ext: 'png' },
        { bytes: new Uint8Array([2]), ext: 'png' },
      ];
    });
    const progress = vi.fn();

    const result = await pdfToImages('png').run?.({ file: source, values: {}, onProgress: progress });

    expect(mocks.saveResult.mock.calls.map(([input]) => input.name)).toEqual([
      'Quarterly Report p1.png',
      'Quarterly Report p2.png',
    ]);
    expect(progress).toHaveBeenCalledWith(0.4);
    expect(progress).toHaveBeenLastCalledWith(1);
    expect(result).toHaveLength(2);
  });

  it('falls back to the server and orders rendered ZIP pages by filename', async () => {
    mocks.renderPdfToImages.mockRejectedValue(new Error('pdf.js unavailable'));
    mocks.checkServer.mockResolvedValue(status(true, { pdfUtility: true }));
    const zip = new JSZip();
    zip.file('page-002.jpg', new Uint8Array([2]));
    zip.file('page-001.jpg', new Uint8Array([1]));
    zip.file('notes.txt', 'ignored');
    mocks.convertFile.mockResolvedValue({
      bytes: await zip.generateAsync({ type: 'uint8array' }),
      filename: 'pages.zip',
      mime: 'application/zip',
      report: { pagesConverted: 2 },
    });

    const result = await pdfToImages('jpg').run?.({ file: source, values: {}, onProgress: vi.fn() });

    expect(mocks.convertFile).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'pdf/render', fields: { format: 'jpg', dpi: 180 } }),
    );
    expect(mocks.saveResult.mock.calls.map(([input]) => Array.from(input.bytes))).toEqual([[1], [2]]);
    expect(result).toHaveLength(2);
  });

  it('extracts backend text using the saved OCR language and exposes export options', async () => {
    mocks.settings.ocrLanguage = 'tgk';
    mocks.checkServer.mockResolvedValue(status(true, { pdfUtility: true }));
    mocks.convertFile.mockResolvedValue({
      bytes: new TextEncoder().encode('Extracted text'),
      filename: 'result',
      mime: 'text/plain',
      report: { engine: 'pymupdf' },
    });

    await backendPdfText(source, vi.fn());
    expect(mocks.convertFile).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'pdf/text', fields: { language: 'tgk' } }),
    );
    expect(mocks.saveResult).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Quarterly Report.txt', kind: 'text', mime: 'text/plain' }),
    );

    expect(pdfExportTo('xlsx')).toMatchObject({ serverCapability: 'pdfExport' });
    expect(pdfExportTo('pptx').fields?.[1]).toMatchObject({ key: 'textLayer', default: true });
  });

  it('maps spreadsheet and HTML export fields into backend conversion requests', async () => {
    mocks.settings.ocrLanguage = 'rus';
    mocks.convertFile.mockResolvedValue({
      bytes: new Uint8Array([4]),
      filename: 'result',
      mime: 'application/octet-stream',
    });

    await pdfExportTo('xlsx').run?.({
      file: source,
      values: { language: '', tableDetection: true },
      onProgress: vi.fn(),
    });
    expect(mocks.convertFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: { target: 'xlsx', language: 'rus', tableDetection: true, textLayer: true },
      }),
    );

    await pdfExportTo('html').run?.({
      file: source,
      values: { language: 'eng+rus', textLayer: false },
      onProgress: vi.fn(),
    });
    expect(mocks.convertFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fields: { target: 'html', language: 'eng+rus', tableDetection: false, textLayer: false },
      }),
    );
  });
});
