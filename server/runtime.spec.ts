import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({ spawnSync: runtimeMocks.spawnSync }));
vi.mock('node:fs', () => ({
  existsSync: runtimeMocks.existsSync,
  readdirSync: runtimeMocks.readdirSync,
}));

const originalPlatform = process.platform;
const originalLocalAppData = process.env.LOCALAPPDATA;
const pythonImports = ['pdf2docx', 'fitz', 'docx', 'PIL', 'openpyxl', 'pptx'];

function importProbeOutput(results: Record<string, boolean>): string {
  return `optional import noise\nFILEMINT_IMPORTS=${JSON.stringify(results)}`;
}

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform });
}

function noRuntimeTools() {
  runtimeMocks.existsSync.mockReturnValue(false);
  runtimeMocks.readdirSync.mockReturnValue([]);
  runtimeMocks.spawnSync.mockReturnValue({
    error: new Error('not installed'),
    status: null,
    stderr: Buffer.alloc(0),
    stdout: Buffer.alloc(0),
  });
}

async function importRuntime(platform: NodeJS.Platform = originalPlatform) {
  setPlatform(platform);
  return import('./runtime');
}

beforeEach(() => {
  vi.resetModules();
  runtimeMocks.existsSync.mockReset();
  runtimeMocks.readdirSync.mockReset();
  runtimeMocks.spawnSync.mockReset();
  noRuntimeTools();
});

afterEach(() => {
  setPlatform(originalPlatform);
  if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = originalLocalAppData;
});

describe('conversion runtime discovery', () => {
  it('accepts only existing explicit executable paths before trying PATH commands', async () => {
    const { resolveBinary } = await importRuntime('linux');
    runtimeMocks.existsSync.mockClear();
    runtimeMocks.spawnSync.mockClear();
    runtimeMocks.existsSync.mockImplementation((candidate) => candidate === process.execPath);
    runtimeMocks.spawnSync.mockReturnValue({ status: 0 });

    expect(resolveBinary(['/missing/tool', process.execPath, 'ignored'], ['--version'])).toBe(
      process.execPath,
    );
    expect(runtimeMocks.spawnSync).not.toHaveBeenCalled();

    expect(resolveBinary(['/missing/tool', 'available'], ['--version'])).toBe('available');
    expect(runtimeMocks.spawnSync).toHaveBeenCalledWith('available', ['--version'], {
      timeout: 8000,
    });
  });

  it('recognizes successful and informative command probes', async () => {
    const { resolveBinary } = await importRuntime('linux');
    runtimeMocks.spawnSync
      .mockReturnValueOnce({ error: new Error('missing'), status: null })
      .mockReturnValueOnce({ status: 7, stdout: Buffer.from('version') })
      .mockReturnValueOnce({ status: 7, stderr: Buffer.from('version') })
      .mockReturnValue({ status: 0 });

    expect(resolveBinary(['missing', 'stdout-tool'], ['--version'])).toBe('stdout-tool');
    expect(resolveBinary(['stderr-tool'], ['--version'])).toBe('stderr-tool');
    expect(resolveBinary(['zero-tool'], ['--version'])).toBe('zero-tool');
  });

  it('falls through failed and throwing command probes without escaping an error', async () => {
    const { resolveBinary } = await importRuntime('linux');
    runtimeMocks.spawnSync
      .mockReturnValueOnce({ status: 9, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) })
      .mockImplementationOnce(() => {
        throw new Error('probe failed');
      })
      .mockReturnValueOnce({ status: 0 });

    expect(resolveBinary(['silent-failure', 'throwing-probe', 'fallback'], ['-v'])).toBe('fallback');

    runtimeMocks.spawnSync.mockImplementation(() => {
      throw new Error('all probes failed');
    });
    expect(resolveBinary(['first', 'second'], ['-v'])).toBeNull();
  });

  it('does not scan Windows installation roots on other platforms', async () => {
    const { findWindowsScript } = await importRuntime('linux');

    expect(findWindowsScript('pdf2docx.exe')).toEqual([]);
    expect(runtimeMocks.readdirSync).not.toHaveBeenCalled();
  });

  it('discovers only existing pip scripts from bounded Windows Python roots', async () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    const { findWindowsScript } = await importRuntime('win32');
    runtimeMocks.existsSync.mockClear();
    runtimeMocks.readdirSync.mockClear();
    runtimeMocks.readdirSync.mockImplementation((root) => {
      if (`${root}`.includes('AppData')) return ['Python311', 'Python312', 'NotPython'];
      if (`${root}` === 'C:\\Program Files') throw new Error('access denied');
      return ['PythonEmbedded'];
    });
    const expected = join(
      process.env.LOCALAPPDATA,
      'Programs',
      'Python',
      'Python312',
      'Scripts',
      'ocrmypdf.exe',
    );
    runtimeMocks.existsSync.mockImplementation((candidate) => candidate === expected);

    expect(findWindowsScript('ocrmypdf.exe')).toEqual([expected]);
    expect(runtimeMocks.readdirSync).toHaveBeenCalledTimes(3);
    expect(runtimeMocks.existsSync).not.toHaveBeenCalledWith(expect.stringContaining('NotPython'));
  });

  it('prefers a discovered Windows Python executable and ignores missing candidates', async () => {
    process.env.LOCALAPPDATA = 'C:\\Users\\tester\\AppData\\Local';
    const runtime = await importRuntime('win32');
    runtimeMocks.readdirSync.mockImplementation((root) =>
      `${root}`.includes('AppData') ? ['Python', 'Python310', 'Python312'] : [],
    );
    const expected = join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe');
    runtimeMocks.existsSync.mockImplementation((candidate) => candidate === expected);
    runtimeMocks.spawnSync.mockClear();

    expect(runtime.findPython()).toBe(expected);
    expect(runtimeMocks.spawnSync).not.toHaveBeenCalled();
  });

  it('accepts Python 3 from stdout or stderr and rejects aliases and probe failures', async () => {
    const { findPython } = await importRuntime('linux');
    runtimeMocks.spawnSync.mockClear();
    runtimeMocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'Python 2.7.18', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: 'Python 3.12.4' });

    expect(findPython()).toBe('python');
    expect(runtimeMocks.spawnSync).toHaveBeenNthCalledWith(1, 'python3', ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    });

    runtimeMocks.spawnSync
      .mockImplementationOnce(() => {
        throw new Error('blocked');
      })
      .mockReturnValueOnce({ error: new Error('alias'), status: null, stdout: '', stderr: '' });
    expect(findPython()).toBeNull();
  });

  it('checks every Python import once and reuses partial capability results', async () => {
    runtimeMocks.spawnSync.mockImplementation((command, args) => {
      if (args?.[0] === '--version' && command === 'python3') {
        return { status: 0, stdout: 'Python 3.12.4', stderr: '' };
      }
      if (args?.[0] === '-c' && command === 'python3') {
        return {
          status: 0,
          stdout: importProbeOutput({
            PIL: true,
            docx: false,
            fitz: true,
            openpyxl: false,
            pdf2docx: true,
            pptx: true,
          }),
        };
      }
      return { error: new Error('not installed'), status: null };
    });
    const runtime = await importRuntime('linux');
    const importProbes = runtimeMocks.spawnSync.mock.calls.filter(([, args]) => args?.[0] === '-c');

    expect(importProbes).toHaveLength(1);
    expect(importProbes[0]?.[0]).toBe('python3');
    expect(importProbes[0]?.[1]?.[1]).toContain('importlib.import_module');
    expect(importProbes[0]?.[2]).toMatchObject({
      encoding: 'utf8',
      input: JSON.stringify(pythonImports),
      maxBuffer: 64 * 1024,
      timeout: 8000,
      windowsHide: true,
    });
    expect(runtime.PY_IMAGE_NORMALIZE).toBe(true);
    expect(runtime.PY_PDF_UTILITY).toBe(true);
    expect(runtime.PY_PDF_TO_DOCX).toBe(false);
    expect(runtime.PY_PDF_EXPORT).toBe(false);

    expect(runtime.pythonCanImport(['fitz', 'PIL'])).toBe(true);
    expect(runtime.pythonCanImport(['missing_module'])).toBe(false);
    expect(runtimeMocks.spawnSync.mock.calls.filter(([, args]) => args?.[0] === '-c')).toHaveLength(1);
  });

  it('never passes unsupported module names to the Python interpreter', async () => {
    const runtime = await importRuntime('linux');
    runtimeMocks.spawnSync.mockClear();
    runtimeMocks.spawnSync.mockReturnValueOnce({
      status: 0,
      stdout: importProbeOutput({ fitz: true }),
    });

    const unsafeName = 'fitz; __import__("os").system("echo unsafe")';
    expect(runtime.probePythonImports('python3', ['fitz', unsafeName])).toEqual({
      fitz: true,
      [unsafeName]: false,
    });
    expect(runtimeMocks.spawnSync).toHaveBeenCalledOnce();
    expect(runtimeMocks.spawnSync.mock.calls[0]?.[2]).toMatchObject({ input: '["fitz"]' });
  });

  it.each([
    ['missing marker', { status: 0, stdout: '{"fitz":true}' }],
    ['malformed output', { status: 0, stdout: 'FILEMINT_IMPORTS={broken' }],
    [
      'timeout',
      {
        error: Object.assign(new Error('probe timed out'), { code: 'ETIMEDOUT' }),
        status: null,
        stdout: '',
      },
    ],
  ])('fails every Python capability closed after %s', async (_caseName, probeResult) => {
    runtimeMocks.spawnSync.mockImplementation((command, args) => {
      if (args?.[0] === '--version' && command === 'python3') {
        return { status: 0, stdout: 'Python 3.12.4', stderr: '' };
      }
      if (args?.[0] === '-c' && command === 'python3') return probeResult;
      return { error: new Error('not installed'), status: null };
    });

    const runtime = await importRuntime('linux');

    expect(Object.values(runtime.PYTHON_IMPORTS).every((available) => !available)).toBe(true);
    expect(runtime.PY_PDF_TO_DOCX).toBe(false);
    expect(runtime.PY_PDF_EXPORT).toBe(false);
    expect(runtime.PY_PDF_EDIT).toBe(false);
    expect(runtimeMocks.spawnSync.mock.calls.filter(([, args]) => args?.[0] === '-c')).toHaveLength(1);
  });

  it('skips import probes when Python is unavailable and reports all capabilities safely', async () => {
    const { CAPABILITIES, pythonCanImport } = await importRuntime('linux');
    expect(runtimeMocks.spawnSync.mock.calls.filter(([, args]) => args?.[0] === '-c')).toHaveLength(0);
    runtimeMocks.spawnSync.mockClear();

    expect(pythonCanImport(['fitz'])).toBe(false);
    expect(runtimeMocks.spawnSync).not.toHaveBeenCalled();
    expect(CAPABILITIES).toEqual({
      ghostscript: false,
      imageNormalize: false,
      libreoffice: false,
      ocr: false,
      pdf2docx: false,
      pdfEdit: false,
      pdfExport: false,
      pdfRepair: false,
      pdfUtility: false,
      qpdf: false,
    });
  });

  it('reports capabilities when command and Python probes succeed', async () => {
    runtimeMocks.spawnSync.mockImplementation((command, args) => {
      if (args?.[0] === '--version' && command === 'python3') {
        return { status: 0, stdout: 'Python 3.12.4', stderr: '' };
      }
      if (args?.[0] === '-c' && command === 'python3') {
        return {
          status: 0,
          stdout: importProbeOutput(Object.fromEntries(pythonImports.map((name) => [name, true]))),
        };
      }
      return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    });
    const { CAPABILITIES } = await importRuntime('linux');

    expect(Object.values(CAPABILITIES).every(Boolean)).toBe(true);
  });
});
