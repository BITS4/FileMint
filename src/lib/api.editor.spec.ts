import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeEdit,
  downloadEdited,
  getEditorLaunch,
  getEditorUrl,
  getEditVersion,
  uploadForEdit,
} from './api';

const mocks = vi.hoisted(() => {
  const settings = {
    serverUrl: 'https://api.example.com',
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

function healthResponse() {
  return new Response(JSON.stringify({ capabilities: { collabora: true } }), { status: 200 });
}

describe('Collabora editor client', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.settings.serverUrl = 'https://api.example.com';
    mocks.settings.update.mockReset().mockImplementation((patch) => Object.assign(mocks.settings, patch));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads a web file and preserves the editor origin', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'blob:draft') return new Response(new Blob(['draft']));
      if (url.endsWith('/health')) return healthResponse();
      const form = init?.body as FormData;
      expect(form.get('file')).toBeInstanceOf(Blob);
      expect(form.get('origin')).toBe('https://app.example.com');
      return new Response(JSON.stringify({ id: 'edit-1', token: 'secret', fileName: 'draft.docx' }), {
        status: 200,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      uploadForEdit('blob:draft', 'draft.docx', undefined, 'https://app.example.com'),
    ).resolves.toEqual({ id: 'edit-1', token: 'secret', fileName: 'draft.docx' });
  });

  it('returns complete launch metadata and keeps the URL-only compatibility helper', async () => {
    const payload = {
      url: 'https://collabora.example.com/editor',
      frameAllowed: false,
      framePolicy: "frame-ancestors 'self'",
      frameError: 'blocked origin',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
    );

    await expect(getEditorLaunch('edit 1', 'token/value')).resolves.toEqual(payload);
    await expect(getEditorUrl('edit 1', 'token/value')).resolves.toBe(payload.url);
  });

  it('uses the server error when editor launch fails and a fallback for malformed JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'Collabora is warming up.' }), { status: 502 }),
      )
      .mockResolvedValueOnce(new Response('gateway error', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getEditorLaunch('a', 'b')).rejects.toThrow('Collabora is warming up.');
    await expect(getEditorLaunch('a', 'b')).rejects.toThrow('The editor (Collabora) is unavailable');
  });

  it('reads version changes defensively across success, missing, error, and network responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 4 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getEditVersion('one', 'token')).resolves.toBe(4);
    await expect(getEditVersion('two', 'token')).resolves.toBe(0);
    await expect(getEditVersion('three', 'token')).resolves.toBe(0);
    await expect(getEditVersion('four', 'token')).resolves.toBe(0);
  });

  it('downloads bytes, rejects failed downloads, and treats close as best-effort', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9]), { status: 200 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockRejectedValueOnce(new Error('already closed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadEdited('one', 'token')).resolves.toEqual(new Uint8Array([7, 8, 9]));
    await expect(downloadEdited('missing', 'token')).rejects.toThrow('Could not download the edited file.');
    await expect(closeEdit('one', 'token')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });
});
