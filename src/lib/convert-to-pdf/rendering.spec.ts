import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileItem } from '@/types';

import type { FilterId, StudioPage } from './model';
import { editedPreviewImage, renderPages, sourcePdfFromFile } from './rendering';

const mocks = vi.hoisted(() => ({
  platform: { OS: 'web' },
  convertFile: vi.fn(),
  dataUrl: vi.fn(),
  prepareImageForPdf: vi.fn(),
  csvRowsToPdf: vi.fn(),
  imagesToPdf: vi.fn(),
  pageSizeDimensions: vi.fn(() => [595, 842]),
  textToPdf: vi.fn(),
  renderPdfToImages: vi.fn(),
  saveBytes: vi.fn(),
  getUri: vi.fn(),
  readBytes: vi.fn(),
  decodeUtf8: vi.fn(),
  parseCsvRows: vi.fn(),
  loadZip: vi.fn(),
  imageShouldFail: false,
  naturalWidth: 4,
  naturalHeight: 2,
  imageWidth: 4,
  imageHeight: 2,
  canvasContextAvailable: true,
  blobAvailable: true,
}));

vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('jszip', () => ({ default: { loadAsync: mocks.loadZip } }));
vi.mock('@/lib/api', () => ({ convertFile: mocks.convertFile }));
vi.mock('@/lib/base64', () => ({ dataUrl: mocks.dataUrl }));
vi.mock('@/lib/image', () => ({ prepareImageForPdf: mocks.prepareImageForPdf }));
vi.mock('@/lib/pdf', () => ({
  csvRowsToPdf: mocks.csvRowsToPdf,
  imagesToPdf: mocks.imagesToPdf,
  pageSizeDimensions: mocks.pageSizeDimensions,
  textToPdf: mocks.textToPdf,
}));
vi.mock('@/lib/pdf-render', () => ({ renderPdfToImages: mocks.renderPdfToImages }));
vi.mock('@/lib/storage', () => ({
  saveBytes: mocks.saveBytes,
  getUri: mocks.getUri,
  readBytes: mocks.readBytes,
}));
vi.mock('@/lib/text', () => ({
  decodeUtf8: mocks.decodeUtf8,
  parseCsvRows: mocks.parseCsvRows,
}));

const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]);

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'Quarterly report.docx',
    kind: 'word',
    ext: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 42,
    createdAt: 1,
    modifiedAt: 1,
    favorite: false,
    storageKey: 'stored-file',
    source: 'import',
    ...overrides,
  };
}

function settings(
  overrides: Partial<Parameters<typeof sourcePdfFromFile>[1]> = {},
): Parameters<typeof sourcePdfFromFile>[1] {
  return {
    pageSize: 'a4',
    orientation: 'landscape',
    margin: 'medium',
    csvDelimiter: ',',
    textFontSize: '11',
    ...overrides,
  };
}

function page(filter: FilterId = 'original'): StudioPage {
  return {
    id: 'page-1',
    sourceId: 'source-1',
    fileId: 'file-1',
    fileName: 'scan.png',
    fileKind: 'image',
    sourceIndex: 0,
    previewBytes: new Uint8Array([1]),
    previewUri: 'data:image/png;base64,AQ==',
    previewWidth: 4,
    previewHeight: 2,
    pageWidthPt: 200,
    pageHeightPt: 100,
    included: true,
    rotation: 0,
    filter,
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    quad: {
      tl: { x: -0.2, y: -0.3 },
      tr: { x: 1.2, y: 0 },
      br: { x: 1.1, y: 1.4 },
      bl: { x: 0, y: 1.3 },
    },
  };
}

function browserHarness() {
  const pixels = new Uint8ClampedArray([
    20, 40, 80, 255, 245, 230, 220, 255, 110, 130, 150, 255, 200, 200, 200, 255,
  ]);
  const context = {
    fillStyle: '',
    fillRect: vi.fn(),
    save: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    drawImage: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(pixels) })),
    putImageData: vi.fn(),
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => (mocks.canvasContextAvailable ? context : null)),
    toBlob: vi.fn((callback: (blob: Blob | null) => void) =>
      callback(mocks.blobAvailable ? new Blob([new Uint8Array([9, 8, 7])]) : null),
    ),
  };
  class BrowserImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = mocks.naturalWidth;
    naturalHeight = mocks.naturalHeight;
    width = mocks.imageWidth;
    height = mocks.imageHeight;

    set src(_value: string) {
      if (mocks.imageShouldFail) this.onerror?.();
      else this.onload?.();
    }
  }
  const createElement = vi.fn(() => canvas);
  vi.stubGlobal('window', { Image: BrowserImage });
  vi.stubGlobal('document', { createElement });
  return { canvas, context, createElement };
}

describe('convert-to-PDF rendering', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.imageShouldFail = false;
    mocks.naturalWidth = 4;
    mocks.naturalHeight = 2;
    mocks.imageWidth = 4;
    mocks.imageHeight = 2;
    mocks.canvasContextAvailable = true;
    mocks.blobAvailable = true;
    for (const value of Object.values(mocks)) {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    }
    mocks.dataUrl.mockReturnValue('data:image/png;base64,AQID');
    mocks.saveBytes.mockResolvedValue({ key: 'temporary.png' });
    mocks.getUri.mockResolvedValue('file:///temporary');
    mocks.readBytes.mockResolvedValue(new Uint8Array([65, 66]));
    mocks.decodeUtf8.mockReturnValue('decoded source');
    mocks.pageSizeDimensions.mockReturnValue([595, 842]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns locally rendered pages and forwards progress', async () => {
    const input = new Uint8Array([1, 2, 3]);
    const progress = vi.fn();
    const rendered = [{ bytes: new Uint8Array([4]), ext: 'png' as const }];
    mocks.renderPdfToImages.mockResolvedValue(rendered);

    await expect(renderPages(input, progress)).resolves.toBe(rendered);
    const call = mocks.renderPdfToImages.mock.calls[0];
    expect(call[0]).toEqual(input);
    expect(call[0]).not.toBe(input);
    expect(call.slice(1)).toEqual(['png', 1.55, progress]);
    expect(mocks.convertFile).not.toHaveBeenCalled();
  });

  it('falls back to server rendering, sorts PNG entries, and reports progress', async () => {
    const progress = vi.fn();
    mocks.renderPdfToImages.mockRejectedValue(new Error('local renderer unavailable'));
    mocks.saveBytes.mockResolvedValue({ key: 'preview.pdf' });
    mocks.getUri.mockResolvedValue('blob:preview');
    mocks.convertFile.mockResolvedValue({ bytes: new Uint8Array([7, 7]) });
    const first = { dir: false, name: 'page-001.png', async: vi.fn(async () => new Uint8Array([1])) };
    const second = { dir: false, name: 'PAGE-002.PNG', async: vi.fn(async () => new Uint8Array([2])) };
    mocks.loadZip.mockResolvedValue({
      files: {
        second,
        folder: { dir: true, name: 'folder/', async: vi.fn() },
        text: { dir: false, name: 'notes.txt', async: vi.fn() },
        first,
      },
    });

    await expect(renderPages(new Uint8Array([9]), progress)).resolves.toEqual([
      { bytes: new Uint8Array([1]), ext: 'png' },
      { bytes: new Uint8Array([2]), ext: 'png' },
    ]);
    expect(mocks.saveBytes).toHaveBeenCalledWith(new Uint8Array([9]), 'pdf');
    expect(mocks.convertFile).toHaveBeenCalledWith({
      endpoint: 'pdf/render',
      fileUri: 'blob:preview',
      fileName: 'preview.pdf',
      mime: 'application/pdf',
      fields: { format: 'png', dpi: 160 },
    });
    expect(progress).toHaveBeenCalledWith(0.65);
  });

  it('rejects a server preview archive with no page images', async () => {
    mocks.renderPdfToImages.mockRejectedValue(new Error('local failure'));
    mocks.convertFile.mockResolvedValue({ bytes: new Uint8Array([1]) });
    mocks.loadZip.mockResolvedValue({
      files: { readme: { dir: false, name: 'readme.txt', async: vi.fn() } },
    });

    await expect(renderPages(new Uint8Array([1]))).rejects.toThrow(
      'The server did not return preview pages.',
    );
  });

  it('uses the native image preparation path outside a browser', async () => {
    mocks.platform.OS = 'ios';
    mocks.prepareImageForPdf.mockResolvedValue({ bytes: new Uint8Array([5]), ext: 'jpg' });

    await expect(editedPreviewImage(page('whiteboard'), new Uint8Array([3]))).resolves.toEqual({
      bytes: new Uint8Array([5]),
      ext: 'png',
    });
    expect(mocks.saveBytes).toHaveBeenCalledWith(new Uint8Array([3]), 'png');
    expect(mocks.prepareImageForPdf).toHaveBeenCalledWith('temporary.png', 'png', { filter: 'bw' });
  });

  it('also uses native preparation when browser globals are unavailable', async () => {
    mocks.prepareImageForPdf.mockResolvedValue({ bytes: new Uint8Array([6]) });
    await expect(editedPreviewImage(page('original'), new Uint8Array([4]))).resolves.toEqual({
      bytes: new Uint8Array([6]),
      ext: 'png',
    });
    expect(mocks.prepareImageForPdf).toHaveBeenCalledWith('temporary.png', 'png', { filter: 'none' });
  });

  it('crops and encodes browser previews across every visual filter', async () => {
    const filters: FilterId[] = [
      'original',
      'auto-enhance',
      'enhance',
      'enhance-2',
      'magic-color',
      'auto-color',
      'light-text',
      'bw',
      'grayscale',
      'whiteboard',
      'high-contrast',
      'clean-bg',
      'remove-shadows',
      'photo',
      'darker',
      'brighter',
    ];
    for (const filter of filters) {
      const browser = browserHarness();
      const result = await editedPreviewImage(page(filter), new Uint8Array([1, 2, 3]));
      expect(result).toEqual({ bytes: new Uint8Array([9, 8, 7]), ext: 'png' });
      expect(browser.canvas.width).toBe(4);
      expect(browser.canvas.height).toBe(2);
      expect(browser.context.drawImage).toHaveBeenCalledOnce();
      if (filter === 'original') expect(browser.context.getImageData).not.toHaveBeenCalled();
      else expect(browser.context.putImageData).toHaveBeenCalledOnce();
    }
  });

  it('falls back to image width and height when natural dimensions are absent', async () => {
    mocks.naturalWidth = 0;
    mocks.naturalHeight = 0;
    mocks.imageWidth = 8;
    mocks.imageHeight = 6;
    const browser = browserHarness();

    await editedPreviewImage(page('original'), new Uint8Array([1]));
    expect(browser.canvas.width).toBe(8);
    expect(browser.canvas.height).toBe(6);
  });

  it('reports browser image, canvas, and encoding failures', async () => {
    mocks.imageShouldFail = true;
    browserHarness();
    await expect(editedPreviewImage(page(), new Uint8Array([1]))).rejects.toThrow(
      'Could not decode preview image for crop.',
    );

    mocks.imageShouldFail = false;
    mocks.canvasContextAvailable = false;
    browserHarness();
    await expect(editedPreviewImage(page(), new Uint8Array([1]))).rejects.toThrow(
      'Canvas is unavailable for crop preview.',
    );

    mocks.canvasContextAvailable = true;
    mocks.blobAvailable = false;
    browserHarness();
    await expect(editedPreviewImage(page(), new Uint8Array([1]))).rejects.toThrow(
      'Could not encode cropped page.',
    );
  });
});

describe('convert-to-PDF source conversion', () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    }
    mocks.getUri.mockResolvedValue('blob:office');
    mocks.readBytes.mockResolvedValue(new Uint8Array([65, 66]));
    mocks.decodeUtf8.mockReturnValue('decoded source');
    mocks.csvRowsToPdf.mockResolvedValue(validPdf);
    mocks.imagesToPdf.mockResolvedValue(validPdf);
    mocks.textToPdf.mockResolvedValue(validPdf);
  });

  it.each([
    ['word', 'docx'],
    ['ppt', 'pptx'],
    ['excel', 'xlsx'],
  ] as const)('converts %s office files through the server', async (kind, ext) => {
    const source = file({ kind, ext, name: `source.${ext}` });
    const conversionReport = { engine: 'libreoffice', pagesConverted: 2 };
    mocks.convertFile.mockResolvedValue({ bytes: validPdf, report: conversionReport });

    await expect(sourcePdfFromFile(source, settings())).resolves.toEqual({
      bytes: validPdf,
      report: conversionReport,
    });
    expect(mocks.getUri).toHaveBeenCalledWith('stored-file');
    expect(mocks.convertFile).toHaveBeenCalledWith({
      endpoint: 'convert',
      fileUri: 'blob:office',
      fileName: `source.${ext}`,
      mime: source.mime,
      fields: { target: 'pdf' },
    });
  });

  it('validates office server output before returning it', async () => {
    mocks.convertFile.mockResolvedValue({ bytes: new Uint8Array([1, 2]) });
    await expect(sourcePdfFromFile(file(), settings())).rejects.toThrow(
      'Quarterly report.docx did not produce a valid PDF',
    );
  });

  it('prepares images and applies page layout choices', async () => {
    const prepared = { bytes: new Uint8Array([4]), ext: 'png' as const, width: 10, height: 20 };
    mocks.prepareImageForPdf.mockResolvedValue(prepared);
    const source = file({ kind: 'image', ext: 'png', name: 'scan.png' });

    await expect(sourcePdfFromFile(source, settings())).resolves.toEqual({ bytes: validPdf });
    expect(mocks.prepareImageForPdf).toHaveBeenCalledWith('stored-file', 'png', {});
    expect(mocks.imagesToPdf).toHaveBeenCalledWith([prepared], {
      pageSize: 'a4',
      orientation: 'landscape',
      margin: 42,
      fit: 'contain',
    });
  });

  it('validates image-generated PDFs', async () => {
    mocks.prepareImageForPdf.mockResolvedValue({ bytes: new Uint8Array([4]), ext: 'png' });
    mocks.imagesToPdf.mockResolvedValue(new Uint8Array([4]));
    await expect(
      sourcePdfFromFile(file({ kind: 'image', ext: 'png', name: 'scan.png' }), settings()),
    ).rejects.toThrow('scan.png did not produce a valid PDF');
  });

  it('parses CSV content using custom and comma delimiters', async () => {
    mocks.decodeUtf8.mockReturnValue('name;score\nAda;10');
    const csv = file({ kind: 'csv', ext: 'txt', name: 'scores.csv' });
    await sourcePdfFromFile(csv, settings({ csvDelimiter: ';' }));
    expect(mocks.csvRowsToPdf).toHaveBeenCalledWith(
      [
        ['name', 'score'],
        ['Ada', '10'],
      ],
      'scores',
    );

    mocks.parseCsvRows.mockReturnValue([['comma', 'row']]);
    const extensionCsv = file({ kind: 'other', ext: 'csv', name: 'fallback.csv' });
    await sourcePdfFromFile(extensionCsv, settings({ csvDelimiter: ',' }));
    expect(mocks.parseCsvRows).toHaveBeenCalledWith('name;score\nAda;10');
  });

  it('rejects empty CSV input and validates generated CSV output', async () => {
    mocks.decodeUtf8.mockReturnValue('\n ; \n');
    await expect(
      sourcePdfFromFile(
        file({ kind: 'csv', ext: 'csv', name: 'empty.csv' }),
        settings({ csvDelimiter: ';' }),
      ),
    ).rejects.toThrow('empty.csv does not contain readable CSV rows.');

    mocks.decodeUtf8.mockReturnValue('a,b');
    mocks.parseCsvRows.mockReturnValue([['a', 'b']]);
    mocks.csvRowsToPdf.mockResolvedValue(new Uint8Array([1]));
    await expect(
      sourcePdfFromFile(file({ kind: 'csv', ext: 'csv', name: 'bad.csv' }), settings()),
    ).rejects.toThrow('bad.csv did not produce a valid PDF');
  });

  it.each([
    ['legal', '2', 7, 'legal'],
    ['letter', '99', 24, 'letter'],
    ['a4', 'not-a-number', 11, 'a4'],
  ] as const)(
    'creates bounded text PDFs for %s pages',
    async (pageSize, requestedSize, expectedSize, expectedPageSize) => {
      const source = file({ kind: 'text', ext: 'txt', name: 'notes.txt' });
      await sourcePdfFromFile(source, settings({ pageSize, textFontSize: requestedSize }));
      expect(mocks.textToPdf).toHaveBeenCalledWith('decoded source', {
        title: 'notes',
        fontSize: expectedSize,
        pageSize: expectedPageSize,
      });
    },
  );

  it('validates generated text output and rejects unsupported file kinds', async () => {
    mocks.textToPdf.mockResolvedValue(new Uint8Array([2]));
    await expect(
      sourcePdfFromFile(file({ kind: 'text', ext: 'txt', name: 'bad.txt' }), settings()),
    ).rejects.toThrow('bad.txt did not produce a valid PDF');

    await expect(
      sourcePdfFromFile(file({ kind: 'archive', ext: 'zip', name: 'bundle.zip' }), settings()),
    ).rejects.toThrow('bundle.zip is not supported for PDF conversion.');
    expect(mocks.readBytes).toHaveBeenCalledWith('stored-file');
  });
});
