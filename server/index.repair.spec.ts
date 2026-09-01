import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { app } from './index';

const runtime = vi.hoisted(() => ({
  python: 'python',
  pdfRepair: true,
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
  PY_PDF_EXPORT: true,
  PY_PDF_TO_DOCX: true,
  PY_PDF_UTILITY: true,
  PY_SEARCHABLE_PDF: true,
  get BIN() {
    return runtime.bin;
  },
  get PYTHON() {
    return runtime.python;
  },
  get PY_PDF_REPAIR() {
    return runtime.pdfRepair;
  },
}));
vi.mock('./conversion-files', () => ({
  libreConvert: vi.fn(),
  makeWorkdir: vi.fn(),
  run: vi.fn(),
  saveUpload: vi.fn(),
  sendFile: vi.fn(),
}));

function repair() {
  return app.request('/repair', { method: 'POST', body: new FormData() });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.python = 'python';
  runtime.pdfRepair = true;
  runtime.bin = { pdf2docx: '', ocrmypdf: '', qpdf: '', gs: '', soffice: '' };
  vi.mocked(makeWorkdir).mockResolvedValue('/tmp/repair');
  vi.mocked(saveUpload).mockResolvedValue({
    path: '/tmp/repair/damaged.pdf',
    name: 'quarterly.scan.pdf',
  });
  vi.mocked(run).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(sendFile).mockImplementation(async (context, dir, output, name) =>
    context.json({ dir, output, name }),
  );
});

describe('PDF repair route', () => {
  it('prefers Ghostscript and returns the repaired artifact', async () => {
    runtime.bin.gs = 'ghostscript';

    const response = await repair();

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('ghostscript', [
      '-o',
      expect.stringMatching(/repaired\.pdf$/),
      '-sDEVICE=pdfwrite',
      '-dPDFSETTINGS=/prepress',
      '/tmp/repair/damaged.pdf',
    ]);
    expect(await response.json()).toEqual({
      dir: '/tmp/repair',
      output: expect.stringMatching(/repaired\.pdf$/),
      name: 'quarterly.scan repaired.pdf',
    });
  });

  it('uses qpdf and continues when its in-place repair probe fails', async () => {
    runtime.bin.qpdf = 'qpdf';
    vi.mocked(run)
      .mockRejectedValueOnce(new Error('input cannot be replaced'))
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' });

    expect((await repair()).status).toBe(200);
    expect(run).toHaveBeenNthCalledWith(1, 'qpdf', ['--replace-input', '/tmp/repair/damaged.pdf']);
    expect(run).toHaveBeenNthCalledWith(2, 'qpdf', [
      '/tmp/repair/damaged.pdf',
      expect.stringMatching(/repaired\.pdf$/),
    ]);
  });

  it('uses qpdf after a successful in-place repair probe', async () => {
    runtime.bin.qpdf = 'qpdf';

    expect((await repair()).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('falls back to the Python repair helper', async () => {
    const response = await repair();

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('python', [
      '/server/pdf_repair.py',
      '--input',
      '/tmp/repair/damaged.pdf',
      '--output',
      expect.stringMatching(/repaired\.pdf$/),
    ]);
  });

  it('reports an unavailable repair engine', async () => {
    runtime.python = '';
    runtime.pdfRepair = false;

    const response = await repair();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'PDF repair engine is not installed on the server.',
    });
    expect(rm).toHaveBeenCalledWith('/tmp/repair', { recursive: true, force: true });
  });

  it('rejects a repair command that does not produce an artifact', async () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const response = await repair();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Repair failed.' });
  });

  it('returns the generic error for non-Error failures and ignores cleanup races', async () => {
    vi.mocked(run).mockRejectedValueOnce('unexpected failure');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));

    const response = await repair();

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Repair failed.' });
  });
});
