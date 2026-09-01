import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { libreConvert, makeWorkdir, run, saveUpload, sendFile } from './conversion-files';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  randomUUID: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
  writeFile: vi.fn(),
  existsSync: vi.fn(),
  tmpdir: vi.fn(),
  pathToFileURL: vi.fn(),
  bin: { soffice: '/tools/soffice' as string | null },
}));

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:crypto', () => ({ randomUUID: mocks.randomUUID }));
vi.mock('node:fs/promises', () => ({
  mkdir: mocks.mkdir,
  readFile: mocks.readFile,
  readdir: mocks.readdir,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));
vi.mock('node:fs', () => ({ existsSync: mocks.existsSync }));
vi.mock('node:os', () => ({ tmpdir: mocks.tmpdir }));
vi.mock('node:url', () => ({ pathToFileURL: mocks.pathToFileURL }));
vi.mock('./runtime', () => ({ BIN: mocks.bin }));

interface ProcessOptions {
  stdout?: (string | Uint8Array)[];
  stderr?: (string | Uint8Array)[];
  code?: number | null;
  error?: Error;
  streams?: boolean;
  signal?: NodeJS.Signals | null;
}

function processResult({
  stdout = [],
  stderr = [],
  code = 0,
  error,
  streams = true,
  signal = null,
}: ProcessOptions = {}) {
  const output = streams
    ? {
        on: vi.fn((event: string, listener: (chunk: string | Uint8Array) => void) => {
          if (event === 'data') stdout.forEach(listener);
        }),
      }
    : null;
  const errors = streams
    ? {
        on: vi.fn((event: string, listener: (chunk: string | Uint8Array) => void) => {
          if (event === 'data') stderr.forEach(listener);
        }),
      }
    : null;
  return {
    stdout: output,
    stderr: errors,
    on: vi.fn((event: string, listener: (value?: unknown, signal?: NodeJS.Signals | null) => void) => {
      if (event === 'error' && error) listener(error);
      if (event === 'close' && !error) listener(code, signal);
    }),
    kill: vi.fn(),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe('conversion child-process and work-directory utilities', () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    }
    mocks.bin.soffice = '/tools/soffice';
    mocks.randomUUID.mockReturnValue('fixed-uuid');
    mocks.tmpdir.mockReturnValue(join('C:', 'temporary'));
    mocks.pathToFileURL.mockReturnValue({ href: 'file:///temporary/profile' });
    mocks.mkdir.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.readdir.mockResolvedValue([]);
    mocks.rm.mockResolvedValue(undefined);
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.existsSync.mockReturnValue(false);
    mocks.spawn.mockReturnValue(processResult());
  });

  it('captures chunked stdout, stderr, spawn arguments, and explicit exit code', async () => {
    mocks.spawn.mockReturnValue(
      processResult({
        stdout: ['ready ', Buffer.from('now')],
        stderr: ['warning'],
        code: 7,
      }),
    );

    await expect(run('/tools/converter', ['--input', 'file'], 321)).resolves.toEqual({
      code: 7,
      stdout: 'ready now',
      stderr: 'warning',
    });
    expect(mocks.spawn).toHaveBeenCalledWith('/tools/converter', ['--input', 'file'], {
      timeout: 321,
      windowsHide: true,
    });
  });

  it('defaults a null close code and tolerates missing output streams', async () => {
    mocks.spawn.mockReturnValue(processResult({ code: null, streams: false }));
    await expect(run('quiet', [])).resolves.toEqual({ code: 0, stdout: '', stderr: '' });
    expect(mocks.spawn).toHaveBeenCalledWith('quiet', [], { timeout: 180000, windowsHide: true });
  });

  it('reports signaled exits as failures and bounds captured process output', async () => {
    mocks.spawn.mockReturnValueOnce(processResult({ code: null, signal: 'SIGTERM' }));
    await expect(run('timed-out', [])).resolves.toMatchObject({ code: 124 });

    vi.stubEnv('FILEMINT_MAX_PROCESS_OUTPUT_BYTES', '1024');
    const noisy = processResult({ stdout: ['x'.repeat(1025)] });
    mocks.spawn.mockReturnValueOnce(noisy);
    await expect(run('noisy', [])).rejects.toThrow('safety limit');
    expect(noisy.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects when child-process spawning emits an error', async () => {
    mocks.spawn.mockReturnValue(processResult({ error: new Error('spawn denied') }));
    await expect(run('missing', [])).rejects.toThrow('spawn denied');
  });

  it('creates a recursive isolated work directory', async () => {
    const expected = join(join('C:', 'temporary'), 'filemint-fixed-uuid');
    await expect(makeWorkdir()).resolves.toBe(expected);
    expect(mocks.mkdir).toHaveBeenCalledWith(expected, { recursive: true });
  });

  it('sanitizes uploads and writes their exact bytes', async () => {
    const upload = new File([new Uint8Array([9, 8, 7])], '../unsafe:name?.txt');
    const dir = join('C:', 'work');

    await expect(saveUpload(dir, upload)).resolves.toEqual({
      path: join(dir, 'unsafe_name_.txt'),
      name: 'unsafe_name_.txt',
    });
    expect(mocks.writeFile).toHaveBeenCalledWith(join(dir, 'unsafe_name_.txt'), Buffer.from([9, 8, 7]));
  });

  it('uses a stable input name and rejects non-File multipart values', async () => {
    const unnamed = new File(['data'], '');
    await expect(saveUpload('/work', unnamed)).resolves.toEqual({
      path: join('/work', 'input'),
      name: 'input',
    });
    await expect(saveUpload('/work', { name: 'fake.pdf' })).rejects.toThrow(
      'No file uploaded under field "file".',
    );
  });
});

describe('conversion response and LibreOffice utilities', () => {
  beforeEach(() => {
    for (const value of Object.values(mocks)) {
      if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    }
    mocks.bin.soffice = '/tools/soffice';
    mocks.pathToFileURL.mockReturnValue({ href: 'file:///work/lo-profile' });
    mocks.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    mocks.rm.mockResolvedValue(undefined);
    mocks.readdir.mockResolvedValue([]);
    mocks.existsSync.mockReturnValue(false);
    mocks.spawn.mockReturnValue(processResult());
  });

  it('sends known MIME headers, encoded names, and extra report metadata', async () => {
    const response = { ok: true };
    const context = { body: vi.fn(() => response) };
    const dir = join('C:', 'work');
    const output = join(dir, 'result.pdf');

    await expect(
      sendFile(context as never, dir, output, 'résumé final.pdf', {
        'X-FileMint-Report': 'encoded-report',
      }),
    ).resolves.toBe(response);
    expect(mocks.readFile).toHaveBeenCalledWith(output);
    expect(mocks.rm).toHaveBeenCalledWith(dir, { recursive: true, force: true });
    expect(context.body).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition':
        'attachment; filename="résumé final.pdf"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20final.pdf',
      'Access-Control-Expose-Headers': 'Content-Disposition, X-FileMint-Report',
      'X-FileMint-Report': 'encoded-report',
    });
  });

  it('uses the binary MIME fallback and still responds if cleanup fails', async () => {
    mocks.rm.mockRejectedValue(new Error('already removed'));
    const response = Symbol('response');
    const context = { body: vi.fn(() => response) };

    await expect(sendFile(context as never, '/work', '/work/result.bin', 'result.UNKNOWN')).resolves.toBe(
      response,
    );
    expect(context.body.mock.calls[0][2]['Content-Type']).toBe('application/octet-stream');
  });

  it('requires a configured LibreOffice executable', async () => {
    mocks.bin.soffice = null;
    await expect(
      libreConvert('/work', { path: '/work/source.docx', name: 'source.docx' }, 'pdf'),
    ).rejects.toThrow('LibreOffice is not installed on the server.');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('returns LibreOffice conventional output when it exists', async () => {
    const dir = join('C:', 'work');
    const input = { path: join(dir, 'annual.report.docx'), name: 'annual.report.docx' };
    const expected = join(dir, 'annual.report.pdf');
    mocks.existsSync.mockReturnValue(true);
    mocks.spawn.mockReturnValue(processResult({ stdout: ['converted'] }));

    await expect(libreConvert(dir, input, 'pdf')).resolves.toBe(expected);
    expect(mocks.pathToFileURL).toHaveBeenCalledWith(join(dir, 'lo-profile'));
    expect(mocks.spawn).toHaveBeenCalledWith(
      '/tools/soffice',
      [
        '--headless',
        '-env:UserInstallation=file:///work/lo-profile',
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        input.path,
      ],
      { timeout: 180000, windowsHide: true },
    );
    expect(mocks.readdir).not.toHaveBeenCalled();
  });

  it('falls back to a case-insensitive produced extension and excludes the input', async () => {
    const dir = join('C:', 'work');
    const input = { path: join(dir, 'source.pdf'), name: 'source.pdf' };
    mocks.readdir.mockResolvedValue(['source.pdf', 'notes.txt', 'Converted.PDF']);

    await expect(libreConvert(dir, input, 'pdf')).resolves.toBe(join(dir, 'Converted.PDF'));
  });

  it('reports stderr, stdout, and bounded empty conversion failures', async () => {
    const input = { path: '/work/source.docx', name: 'source.docx' };
    const longError = `failure ${'x'.repeat(400)}`;
    for (const result of [
      { stderr: longError, stdout: 'ignored' },
      { stderr: '', stdout: 'stdout reason' },
      { stderr: '', stdout: '' },
    ]) {
      mocks.spawn.mockReturnValueOnce(processResult({ stdout: [result.stdout], stderr: [result.stderr] }));
      await expect(libreConvert('/work', input, 'pdf')).rejects.toThrow(
        result.stderr ? 'Conversion failed. failure' : `Conversion failed. ${result.stdout}`,
      );
    }

    try {
      mocks.spawn.mockReturnValue(processResult({ stderr: [longError] }));
      await libreConvert('/work', input, 'pdf');
    } catch (error) {
      expect((error as Error).message.length).toBe(300);
    }
  });

  it('propagates LibreOffice spawn errors', async () => {
    mocks.spawn.mockReturnValue(processResult({ error: new Error('cannot execute') }));
    await expect(
      libreConvert('/work', { path: '/work/source.docx', name: 'source.docx' }, 'pdf'),
    ).rejects.toThrow('cannot execute');
  });
});
