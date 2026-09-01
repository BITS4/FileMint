import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { app } from './index';

const runtime = vi.hoisted(() => ({
  python: 'python',
  imageNormalize: true,
  pdfUtility: true,
  searchablePdf: true,
  bin: { ocrmypdf: 'ocrmypdf', pdf2docx: '', qpdf: '', gs: '', soffice: '' },
}));

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), rm: vi.fn() }));
vi.mock('./auth', () => ({ registerAuth: vi.fn() }));
vi.mock('./edit', () => ({ registerEdit: vi.fn() }));
vi.mock('./middleware', () => ({ registerCoreMiddleware: vi.fn() }));
vi.mock('./health', () => ({ registerHealthRoute: vi.fn() }));
vi.mock('./redaction', () => ({ registerRedactionRoute: vi.fn() }));
vi.mock('./security', () => ({ registerSecurityRoutes: vi.fn() }));
vi.mock('./config', () => ({ COLLABORA_URL: '', WOPI_HOST: '' }));
vi.mock('./runtime', () => ({
  CAPABILITIES: {},
  IMAGE_NORMALIZE_SCRIPT: '/server/image_normalize.py',
  PDF2DOCX_SCRIPT: '/server/pdf_to_docx.py',
  PDF_EXPORT_SCRIPT: '/server/pdf_export.py',
  PDF_REPAIR_SCRIPT: '/server/pdf_repair.py',
  PDF_UTILITY_SCRIPT: '/server/pdf_utility.py',
  SEARCHABLE_PDF_SCRIPT: '/server/searchable_pdf.py',
  PY_PDF_TO_DOCX: true,
  PY_PDF_EXPORT: true,
  PY_PDF_REPAIR: true,
  get BIN() {
    return runtime.bin;
  },
  get PYTHON() {
    return runtime.python;
  },
  get PY_IMAGE_NORMALIZE() {
    return runtime.imageNormalize;
  },
  get PY_PDF_UTILITY() {
    return runtime.pdfUtility;
  },
  get PY_SEARCHABLE_PDF() {
    return runtime.searchablePdf;
  },
}));
vi.mock('./conversion-files', () => ({
  libreConvert: vi.fn(),
  makeWorkdir: vi.fn(),
  run: vi.fn(),
  saveUpload: vi.fn(),
  sendFile: vi.fn(),
}));

function request(path: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return app.request(path, { method: 'POST', body: form });
}

function reportFrom(responseBody: { headers?: Record<string, string> }) {
  return JSON.parse(
    Buffer.from(String(responseBody.headers?.['X-FileMint-Report']), 'base64url').toString('utf8'),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.python = 'python';
  runtime.imageNormalize = true;
  runtime.pdfUtility = true;
  runtime.searchablePdf = true;
  runtime.bin = { ocrmypdf: 'ocrmypdf', pdf2docx: '', qpdf: '', gs: '', soffice: '' };
  vi.mocked(makeWorkdir).mockResolvedValue('/tmp/utility');
  vi.mocked(saveUpload).mockResolvedValue({ path: '/tmp/utility/input.pdf', name: 'source.document.pdf' });
  vi.mocked(run).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  vi.mocked(readFile).mockResolvedValue('{"pages":3}');
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(existsSync).mockImplementation((path) => !String(path).endsWith('report.json'));
  vi.mocked(sendFile).mockImplementation(async (context, dir, output, name, headers = {}) =>
    context.json({ dir, output, name, headers }),
  );
});

describe('image normalization route', () => {
  it('clamps rotation, sanitizes filters, and returns a quality report', async () => {
    vi.mocked(saveUpload).mockResolvedValueOnce({
      path: '/tmp/utility/photo.jpg',
      name: 'phone.photo.jpg',
    });
    vi.mocked(existsSync).mockReturnValue(true);
    const response = await request('/image/normalize', { rotate: '999', filter: 'Gray<script>' });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      [
        '/server/image_normalize.py',
        '--input',
        '/tmp/utility/photo.jpg',
        '--output',
        expect.stringMatching(/normalized\.png$/),
        '--rotate',
        '270',
        '--filter',
        'Grayscript',
        '--report',
        expect.stringMatching(/report\.json$/),
      ],
      180000,
    );
    const body = await response.json();
    expect(body.name).toBe('phone.photo.png');
    expect(reportFrom(body)).toEqual({ pages: 3 });
  });

  it('uses numeric/filter defaults and omits missing reports', async () => {
    const response = await request('/image/normalize', { rotate: 'bad', filter: '!!!' });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining(['--rotate', '0', '--filter', 'none']),
      180000,
    );
    expect((await response.json()).headers).toEqual({});
  });

  it('handles missing capability, missing output, and unknown failures', async () => {
    runtime.imageNormalize = false;
    expect((await request('/image/normalize')).status).toBe(500);

    runtime.imageNormalize = true;
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'normalize diagnostic' });
    expect(await (await request('/image/normalize')).json()).toMatchObject({
      error: expect.stringContaining('normalize diagnostic'),
    });

    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    expect(await (await request('/image/normalize')).json()).toEqual({
      error: 'Image normalization failed.',
    });
  });
});

describe('PDF render route', () => {
  it('renders JPEG pages with bounded DPI and a report', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const response = await request('/pdf/render', { format: 'jpg', dpi: '999' });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining(['--task', 'images', '--format', 'jpg', '--dpi', '360']),
      300000,
    );
    const body = await response.json();
    expect(body.name).toBe('source.document pages.zip');
    expect(reportFrom(body)).toEqual({ pages: 3 });
  });

  it('defaults to PNG and minimum/default DPI values', async () => {
    await request('/pdf/render', { format: 'gif', dpi: '1' });
    expect(run).toHaveBeenLastCalledWith(
      'python',
      expect.arrayContaining(['--format', 'png', '--dpi', '72']),
      300000,
    );
    await request('/pdf/render', { dpi: 'invalid' });
    expect(run).toHaveBeenLastCalledWith(
      'python',
      expect.arrayContaining(['--format', 'png', '--dpi', '180']),
      300000,
    );
  });

  it('reports missing utility capability and missing page archives', async () => {
    runtime.pdfUtility = false;
    expect((await request('/pdf/render')).status).toBe(500);
    runtime.pdfUtility = true;
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: 'render details', stderr: '' });
    expect(await (await request('/pdf/render')).json()).toMatchObject({
      error: expect.stringContaining('render details'),
    });
  });
});

describe('PDF text route', () => {
  it('extracts sanitized language text with and without a report', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const reported = await request('/pdf/text', { language: 'eng+deu!bad' });
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining(['--task', 'text', '--lang', 'eng+deubad']),
      300000,
    );
    expect(reportFrom(await reported.json())).toEqual({ pages: 3 });

    vi.mocked(existsSync).mockImplementation((path) => !String(path).endsWith('report.json'));
    const defaulted = await request('/pdf/text', { language: '!!!' });
    expect(run).toHaveBeenLastCalledWith('python', expect.arrayContaining(['--lang', 'auto']), 300000);
    expect((await defaulted.json()).headers).toEqual({});
  });

  it('handles missing capability, output diagnostics, and non-Error failures', async () => {
    runtime.python = '';
    expect((await request('/pdf/text')).status).toBe(500);
    runtime.python = 'python';
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'text diagnostic' });
    expect(await (await request('/pdf/text')).json()).toMatchObject({
      error: expect.stringContaining('text diagnostic'),
    });

    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    expect(await (await request('/pdf/text')).json()).toEqual({
      error: 'PDF text extraction failed.',
    });
  });
});

describe('searchable PDF OCR route', () => {
  it('runs OCRmyPDF with sanitized options and returns a report', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const response = await request('/ocr', {
      language: 'eng+fra!',
      forceOcr: 'force',
      deskew: 'false',
      rotatePages: 'false',
    });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([
        '--lang',
        'eng+fra',
        '--force',
        'force',
        '--deskew',
        'false',
        '--rotate-pages',
        'false',
        '--ocrmypdf',
        'ocrmypdf',
      ]),
      600000,
    );
    expect(reportFrom(await response.json())).toEqual({ pages: 3 });
  });

  it('supports legacy force/default options and missing reports', async () => {
    const response = await request('/ocr', { language: '!!!', force: 'skip' });
    expect(run).toHaveBeenLastCalledWith(
      'python',
      expect.arrayContaining([
        '--lang',
        'auto',
        '--force',
        'skip',
        '--deskew',
        'true',
        '--rotate-pages',
        'true',
      ]),
      600000,
    );
    expect((await response.json()).headers).toEqual({});
  });

  it('rejects missing OCR capabilities and absent output', async () => {
    runtime.bin.ocrmypdf = '';
    expect((await request('/ocr')).status).toBe(500);
    runtime.bin.ocrmypdf = 'ocrmypdf';
    runtime.searchablePdf = false;
    expect((await request('/ocr')).status).toBe(500);
    runtime.searchablePdf = true;
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'ocr diagnostic' });
    expect(await (await request('/ocr')).json()).toMatchObject({
      error: expect.stringContaining('ocr diagnostic'),
    });
  });

  it('returns the generic OCR error and tolerates cleanup races', async () => {
    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    expect(await (await request('/ocr')).json()).toEqual({ error: 'OCR failed.' });
  });
});
