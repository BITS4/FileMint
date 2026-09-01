import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertFile } from './api';

const mocks = vi.hoisted(() => {
  const settings = {
    serverUrl: 'https://api.example.com/',
    update: vi.fn<(patch: { serverUrl?: string }) => void>(),
  };
  return {
    constants: { expoConfig: {}, expoGoConfig: null, manifest: undefined, experienceUrl: undefined },
    platform: { OS: 'web' },
    settings,
  };
});

vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('@/store/useSettings', () => ({
  PRODUCTION_SERVER_URL: 'https://filemint.example.com',
  useSettings: { getState: () => mocks.settings },
}));

const allCapabilities = {
  libreoffice: true,
  qpdf: true,
  ghostscript: true,
  pdfRepair: true,
  ocr: true,
  pdf2docx: true,
  pdfExport: true,
  imageNormalize: true,
  pdfUtility: true,
  pdfEdit: true,
  collabora: true,
};

function healthResponse() {
  return new Response(JSON.stringify({ version: 'test', capabilities: allCapabilities }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sourceResponse() {
  return new Response(new Blob(['source bytes'], { type: 'application/pdf' }));
}

describe('conversion API requests', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.settings.serverUrl = 'https://api.example.com/';
    mocks.settings.update.mockReset().mockImplementation((patch) => Object.assign(mocks.settings, patch));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('posts a browser file with fields and decodes response metadata', async () => {
    const reportHeader = btoa(JSON.stringify({ engine: 'libreoffice', pagesConverted: 3 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'blob:source') return sourceResponse();
      if (url.endsWith('/health')) return healthResponse();
      const form = init?.body as FormData;
      expect(init?.method).toBe('POST');
      expect(form.get('target')).toBe('pdf');
      expect(form.get('quality')).toBe('90');
      expect(form.get('searchable')).toBe('true');
      expect(form.get('file')).toBeInstanceOf(Blob);
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': "attachment; filename*=UTF-8''Quarter%20Report.pdf",
          'x-filemint-report': reportHeader,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await convertFile({
      endpoint: '/convert',
      fileUri: 'blob:source',
      fileName: 'source.docx',
      fields: { target: 'pdf', quality: 90, searchable: true },
    });

    expect(result).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      filename: 'Quarter Report.pdf',
      mime: 'application/pdf',
      report: { engine: 'libreoffice', pagesConverted: 3 },
    });
  });

  it('falls back to safe response defaults when optional headers are malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'blob:source') return sourceResponse();
        if (url.endsWith('/health')) return healthResponse();
        return new Response(new Uint8Array([8]), {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="output.bin"', 'x-filemint-report': '***' },
        });
      }),
    );

    const result = await convertFile({
      endpoint: 'image/normalize',
      fileUri: 'blob:source',
      fileName: 'x.tif',
    });

    expect(result.filename).toBe('output.bin');
    expect(result.mime).toBe('application/octet-stream');
    expect(result.report).toBeUndefined();
  });

  it('surfaces a structured server validation error without retrying', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'blob:source') return sourceResponse();
      if (url.endsWith('/health')) return healthResponse();
      return new Response(JSON.stringify({ error: 'Password is required.' }), { status: 422 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      convertFile({ endpoint: 'secure/lock', fileUri: 'blob:source', fileName: 'secret.pdf' }),
    ).rejects.toThrow('Password is required.');
  });

  it('turns a missing endpoint into an actionable stale-server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'blob:source') return sourceResponse();
        if (url.endsWith('/health')) return healthResponse();
        return new Response('not found', { status: 404 });
      }),
    );

    await expect(
      convertFile({ endpoint: 'pdf/text', fileUri: 'blob:source', fileName: 'scan.pdf' }),
    ).rejects.toThrow('Server endpoint "/pdf/text" was not found at https://api.example.com');
  });

  it('reports the final server address when the network is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'blob:source') return sourceResponse();
        if (url.endsWith('/health')) throw new Error('offline');
        throw new Error('offline');
      }),
    );

    await expect(
      convertFile({ endpoint: 'ocr', fileUri: 'blob:source', fileName: 'scan.pdf' }),
    ).rejects.toThrow("Can't reach the conversion server at https://api.example.com");
  });
});
