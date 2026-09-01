import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { libreConvert, makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { app } from './index';

const runtime = vi.hoisted(() => ({
  python: 'python',
  pdfToDocx: true,
  pdfExport: true,
  bin: { pdf2docx: '', ocrmypdf: '', qpdf: '', gs: '', soffice: '' },
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
  PY_IMAGE_NORMALIZE: true,
  PY_PDF_REPAIR: true,
  PY_PDF_UTILITY: true,
  PY_SEARCHABLE_PDF: true,
  get BIN() {
    return runtime.bin;
  },
  get PYTHON() {
    return runtime.python;
  },
  get PY_PDF_TO_DOCX() {
    return runtime.pdfToDocx;
  },
  get PY_PDF_EXPORT() {
    return runtime.pdfExport;
  },
}));
vi.mock('./conversion-files', () => ({
  libreConvert: vi.fn(),
  makeWorkdir: vi.fn(),
  run: vi.fn(),
  saveUpload: vi.fn(),
  sendFile: vi.fn(),
}));

function convert(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return app.request('/convert', { method: 'POST', body: form });
}

function decodeReport(value: unknown) {
  return JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.python = 'python';
  runtime.pdfToDocx = true;
  runtime.pdfExport = true;
  runtime.bin = { pdf2docx: '', ocrmypdf: '', qpdf: '', gs: '', soffice: '' };
  vi.mocked(makeWorkdir).mockResolvedValue('/tmp/convert');
  vi.mocked(saveUpload).mockResolvedValue({ path: '/tmp/convert/input.pdf', name: 'annual.report.pdf' });
  vi.mocked(run).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  vi.mocked(readFile).mockResolvedValue('{"engine":"test-engine"}');
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(existsSync).mockImplementation((path) => !String(path).endsWith('report.json'));
  vi.mocked(libreConvert).mockResolvedValue('/tmp/convert/out.pdf');
  vi.mocked(sendFile).mockImplementation(async (context, dir, output, name, headers = {}) =>
    context.json({ dir, output, name, headers }),
  );
});

describe('central PDF to Word conversion route', () => {
  it('runs the configurable Python pipeline and attaches its report', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    const response = await convert({
      target: 'DOCX',
      mode: 'accurate<script>',
      language: 'eng+deu!bad',
      autoDetectLanguage: 'false',
      tableDetection: 'false',
      preserveLayout: 'false',
      keepVisualObjects: 'false',
      visualObjectFormat: 'JPG<script>',
      docxQuality: 'HIGH<script>',
    });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      [
        '/server/pdf_to_docx.py',
        '--input',
        '/tmp/convert/input.pdf',
        '--output',
        expect.stringMatching(/out\.docx$/),
        '--mode',
        'accuratescript',
        '--lang',
        'eng+deubad',
        '--auto-detect-language',
        'false',
        '--table-detection',
        'false',
        '--preserve-layout',
        'false',
        '--keep-visual-objects',
        'false',
        '--visual-object-format',
        'jpgscript',
        '--docx-quality',
        'highscript',
        '--report',
        expect.stringMatching(/report\.json$/),
      ],
      600000,
    );
    const body = await response.json();
    expect(body.name).toBe('annual.report.docx');
    expect(decodeReport(body.headers['X-FileMint-Report'])).toEqual({ engine: 'test-engine' });
  });

  it('uses safe DOCX defaults and omits an unavailable report', async () => {
    const response = await convert({ target: 'docx', mode: '!!!', language: '!!!' });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([
        '--mode',
        'accurate',
        '--lang',
        'auto',
        '--auto-detect-language',
        'true',
        '--table-detection',
        'true',
      ]),
      600000,
    );
    expect((await response.json()).headers).toEqual({});
  });

  it('falls back to the pdf2docx CLI with a bounded compatibility report', async () => {
    runtime.python = '';
    runtime.pdfToDocx = false;
    runtime.bin.pdf2docx = 'pdf2docx';
    const response = await convert({ target: 'docx', mode: 'fast' });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('pdf2docx', [
      'convert',
      '/tmp/convert/input.pdf',
      expect.stringMatching(/out\.docx$/),
    ]);
    const report = decodeReport((await response.json()).headers['X-FileMint-Report']);
    expect(report).toMatchObject({ engine: 'pdf2docx-cli', requestedMode: 'fast' });
  });

  it('reports missing engines and missing output diagnostics with cleanup', async () => {
    runtime.python = '';
    runtime.pdfToDocx = false;
    const unavailable = await convert({ target: 'docx' });
    expect(unavailable.status).toBe(500);
    expect(await unavailable.json()).toMatchObject({ error: expect.stringContaining('pdf2docx') });

    runtime.python = 'python';
    runtime.pdfToDocx = true;
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'conversion diagnostic' });
    const missing = await convert({ target: 'docx' });
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining('conversion diagnostic') });
    expect(rm).toHaveBeenCalledWith('/tmp/convert', { recursive: true, force: true });
  });
});

describe('central PDF export and office conversion route', () => {
  it.each(['xlsx', 'pptx', 'html'])('exports PDF to %s through the Python helper', async (target) => {
    vi.mocked(existsSync).mockReturnValue(true);
    const response = await convert({
      target,
      language: 'eng+fra!',
      tableDetection: 'false',
      textLayer: 'false',
    });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([
        '/server/pdf_export.py',
        '--target',
        target,
        '--lang',
        'eng+fra',
        '--table-detection',
        'false',
        '--text-layer',
        'false',
      ]),
      600000,
    );
    expect(decodeReport((await response.json()).headers['X-FileMint-Report'])).toEqual({
      engine: 'test-engine',
    });
  });

  it('rejects unavailable PDF export and missing generated output', async () => {
    runtime.pdfExport = false;
    expect((await convert({ target: 'xlsx' })).status).toBe(500);
    runtime.pdfExport = true;
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: 'export output', stderr: '' });
    const failed = await convert({ target: 'html' });
    expect(await failed.json()).toMatchObject({ error: expect.stringContaining('export output') });
  });

  it('delegates ordinary Office conversion and defaults the target to PDF', async () => {
    vi.mocked(saveUpload).mockResolvedValueOnce({
      path: '/tmp/convert/input.docx',
      name: 'proposal.docx',
    });
    const response = await convert();
    expect(response.status).toBe(200);
    expect(libreConvert).toHaveBeenCalledWith(
      '/tmp/convert',
      { path: '/tmp/convert/input.docx', name: 'proposal.docx' },
      'pdf',
    );
    expect(await response.json()).toMatchObject({ name: 'proposal.pdf' });
  });

  it('returns a generic conversion error for unknown failures and ignores cleanup races', async () => {
    vi.mocked(libreConvert).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    const response = await convert({ target: 'pdf' });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Conversion failed.' });
  });
});
