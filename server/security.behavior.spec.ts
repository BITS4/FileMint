import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { registerSecurityRoutes } from './security';

const runtime = vi.hoisted(() => ({
  qpdf: 'qpdf',
  python: 'python',
  pdfSecurity: true,
}));

vi.mock('node:fs', () => ({ existsSync: vi.fn() }));
vi.mock('node:fs/promises', () => ({ rm: vi.fn() }));
vi.mock('./runtime', () => ({
  PDF_SECURITY_SCRIPT: '/server/pdf_security.py',
  get BIN() {
    return { qpdf: runtime.qpdf };
  },
  get PYTHON() {
    return runtime.python;
  },
  get PY_PDF_SECURITY() {
    return runtime.pdfSecurity;
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
  registerSecurityRoutes(instance);
  return instance;
}

function request(path: string, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return app().request(path, { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.qpdf = 'qpdf';
  runtime.python = 'python';
  runtime.pdfSecurity = true;
  vi.mocked(makeWorkdir).mockResolvedValue('/tmp/security');
  vi.mocked(saveUpload).mockResolvedValue({ path: '/tmp/security/input.pdf', name: 'private.file.pdf' });
  vi.mocked(run).mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(sendFile).mockImplementation(async (context, dir, output, name) =>
    context.json({ dir, output, name }),
  );
});

describe('PDF lock route', () => {
  it('requires a password and cleans its work directory', async () => {
    const response = await request('/secure/lock');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'A password is required.' });
    expect(rm).toHaveBeenCalledWith('/tmp/security', { recursive: true, force: true });
  });

  it('locks with qpdf and returns a descriptive filename', async () => {
    const response = await request('/secure/lock', { password: 'secret' });
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('qpdf', [
      '--encrypt',
      'secret',
      'secret',
      '256',
      '--',
      '/tmp/security/input.pdf',
      expect.stringMatching(/locked\.pdf$/),
    ]);
    expect(await response.json()).toMatchObject({ name: 'private.file locked.pdf' });
  });

  it('falls back to Python and reports absent output diagnostics', async () => {
    runtime.qpdf = '';
    const success = await request('/secure/lock', { password: 'secret' });
    expect(success.status).toBe(200);
    expect(run).toHaveBeenCalledWith('python', [
      '/server/pdf_security.py',
      '--task',
      'lock',
      '--input',
      '/tmp/security/input.pdf',
      '--output',
      expect.stringMatching(/locked\.pdf$/),
      '--password',
      'secret',
    ]);

    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'lock diagnostic' });
    const missing = await request('/secure/lock', { password: 'secret' });
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining('lock diagnostic') });
  });

  it('rejects requests when neither security engine is installed', async () => {
    runtime.qpdf = '';
    runtime.python = '';
    runtime.pdfSecurity = false;
    const response = await request('/secure/lock', { password: 'secret' });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('not installed') });

    runtime.qpdf = 'qpdf';
    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    expect(await (await request('/secure/lock', { password: 'secret' })).json()).toEqual({
      error: 'Lock failed.',
    });
  });
});

describe('PDF unlock route', () => {
  it('unlocks with qpdf, including an empty password', async () => {
    const response = await request('/secure/unlock');
    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith('qpdf', [
      '--password=',
      '--decrypt',
      '/tmp/security/input.pdf',
      expect.stringMatching(/unlocked\.pdf$/),
    ]);
    expect(await response.json()).toMatchObject({ name: 'private.file unlocked.pdf' });
  });

  it('uses the Python unlock fallback and reports wrong-password output failures', async () => {
    runtime.qpdf = '';
    expect((await request('/secure/unlock', { password: 'secret' })).status).toBe(200);
    expect(run).toHaveBeenCalledWith('python', [
      '/server/pdf_security.py',
      '--task',
      'unlock',
      '--input',
      '/tmp/security/input.pdf',
      '--output',
      expect.stringMatching(/unlocked\.pdf$/),
      '--password',
      'secret',
    ]);

    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'bad password' });
    const failed = await request('/secure/unlock', { password: 'secret' });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ error: expect.stringContaining('bad password') });
  });

  it('handles missing engines and non-Error process failures', async () => {
    runtime.qpdf = '';
    runtime.python = '';
    runtime.pdfSecurity = false;
    expect((await request('/secure/unlock')).status).toBe(500);

    runtime.qpdf = 'qpdf';
    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    const unknown = await request('/secure/unlock');
    expect(await unknown.json()).toEqual({ error: 'Unlock failed.' });
  });
});

describe('PDF permissions route', () => {
  it('requires an owner password', async () => {
    const response = await request('/secure/permissions');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'An owner password is required.' });
  });

  it('maps qpdf print and copy permissions', async () => {
    const allowed = await request('/secure/permissions', {
      ownerPassword: 'owner',
      allowPrint: 'true',
      allowCopy: 'true',
    });
    expect(allowed.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'qpdf',
      expect.arrayContaining(['--print=full', '--extract=y', '--modify=none']),
    );

    await request('/secure/permissions', { ownerPassword: 'owner' });
    expect(run).toHaveBeenLastCalledWith(
      'qpdf',
      expect.arrayContaining(['--print=none', '--extract=n', '--modify=none']),
    );
  });

  it('maps Python permission flags and rejects a missing engine', async () => {
    runtime.qpdf = '';
    const allowed = await request('/secure/permissions', {
      ownerPassword: 'owner',
      allowPrint: 'true',
      allowCopy: 'true',
    });
    expect(allowed.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      'python',
      expect.arrayContaining([
        '--task',
        'permissions',
        '--owner-password',
        'owner',
        '--allow-print',
        '--allow-copy',
      ]),
    );

    await request('/secure/permissions', { ownerPassword: 'owner' });
    const pythonArgs = vi.mocked(run).mock.calls.at(-1)?.[1] ?? [];
    expect(pythonArgs).not.toContain('--allow-print');
    expect(pythonArgs).not.toContain('--allow-copy');

    runtime.python = '';
    runtime.pdfSecurity = false;
    const unavailable = await request('/secure/permissions', { ownerPassword: 'owner' });
    expect(unavailable.status).toBe(500);
    expect(await unavailable.json()).toMatchObject({ error: expect.stringContaining('not installed') });
  });

  it('reports missing protected output and unknown failures', async () => {
    vi.mocked(existsSync).mockReturnValueOnce(false);
    vi.mocked(run).mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'permission failure' });
    const missing = await request('/secure/permissions', { ownerPassword: 'owner' });
    expect(await missing.json()).toMatchObject({ error: expect.stringContaining('permission failure') });

    vi.mocked(run).mockRejectedValueOnce('unknown');
    vi.mocked(rm).mockRejectedValueOnce(new Error('already removed'));
    expect(await (await request('/secure/permissions', { ownerPassword: 'owner' })).json()).toEqual({
      error: 'Failed.',
    });
  });
});
