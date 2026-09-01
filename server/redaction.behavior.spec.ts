import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { registerRedactionRoute } from './redaction';

const runtime = vi.hoisted(() => ({ python: 'python', pdfEdit: true }));

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ rm: vi.fn() }));
vi.mock('./runtime', () => ({
  PDF_EDIT_SCRIPT: '/server/pdf_edit.py',
  get PYTHON() {
    return runtime.python;
  },
  get PY_PDF_EDIT() {
    return runtime.pdfEdit;
  },
}));
vi.mock('./conversion-files', () => ({
  makeWorkdir: vi.fn(),
  run: vi.fn(),
  saveUpload: vi.fn(),
  sendFile: vi.fn(),
}));

function app() {
  const instance = new Hono();
  registerRedactionRoute(instance);
  return instance;
}

function request(fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return app().request('/edit/redact', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.python = 'python';
  runtime.pdfEdit = true;
  vi.mocked(makeWorkdir).mockResolvedValue('/tmp/redaction');
  vi.mocked(saveUpload).mockResolvedValue({ path: '/tmp/redaction/input.pdf', name: 'report.final.pdf' });
  vi.mocked(run).mockResolvedValue({ stdout: '', stderr: '', code: 0 });
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(sendFile).mockImplementation(async (context, dir, output, name) =>
    context.json({ dir, output, name }),
  );
});

describe('PDF redaction route', () => {
  it('sanitizes options and returns the generated redacted file', async () => {
    const response = await request({
      areasJson: '[{"page":0}]',
      color: '##12zz34AA',
      label: 'x'.repeat(100),
    });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([
        '/server/pdf_edit.py',
        '--task',
        'redact',
        '--areas-json',
        '[{"page":0}]',
        '--color',
        '##1234A',
        '--label',
        'x'.repeat(80),
      ]),
      300000,
    );
    expect(await response.json()).toMatchObject({ name: 'report.final redacted.pdf' });
    expect(rm).not.toHaveBeenCalled();
  });

  it('uses safe defaults for omitted form fields', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining(['--areas-json', '[]', '--color', '#000000', '--label', 'Redacted']),
      300000,
    );
  });

  it('fails clearly when the Python redaction engine is unavailable', async () => {
    runtime.python = '';
    runtime.pdfEdit = false;
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('requirements.lock.txt') });
    expect(rm).toHaveBeenCalledWith('/tmp/redaction', { recursive: true, force: true });
  });

  it('reports missing output diagnostics and handles non-Error failures', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: 'stdout details', stderr: 'stderr details' });
    const missing = await request();
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining('stderr details') });

    vi.mocked(run).mockRejectedValueOnce('unexpected');
    vi.mocked(rm).mockRejectedValueOnce(new Error('cleanup already complete'));
    const unknown = await request();
    expect(unknown.status).toBe(500);
    expect(await unknown.json()).toEqual({ error: 'Redaction failed.' });
  });
});
