import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkServer, getServerBaseUrl } from './api';

const mocks = vi.hoisted(() => {
  const settings = {
    serverUrl: 'http://localhost:8787',
    update: vi.fn<(patch: { serverUrl?: string }) => void>(),
  };
  const constants = {
    expoConfig: {} as { hostUri?: string },
    expoGoConfig: null as { debuggerHost?: string } | null,
    manifest: undefined as { debuggerHost?: string } | undefined,
    experienceUrl: undefined as string | undefined,
  };
  const platform = { OS: 'web' };
  return { constants, platform, settings };
});

vi.mock('expo-constants', () => ({ default: mocks.constants }));
vi.mock('react-native', () => ({ Platform: mocks.platform }));
vi.mock('@/store/useSettings', () => ({
  PRODUCTION_SERVER_URL: 'https://filemint.example.com',
  useSettings: { getState: () => mocks.settings },
}));

function health(capabilities: Record<string, boolean>, version = '1.2.3') {
  return new Response(JSON.stringify({ version, capabilities }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('conversion server discovery', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.settings.serverUrl = 'http://localhost:8787';
    mocks.settings.update.mockReset().mockImplementation((patch) => Object.assign(mocks.settings, patch));
    mocks.constants.expoConfig = {};
    mocks.constants.expoGoConfig = null;
    mocks.constants.manifest = undefined;
    mocks.constants.experienceUrl = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('moves a hosted web build away from an unusable localhost server', () => {
    vi.stubGlobal('window', {
      location: { hostname: 'filemint-web.example.com', protocol: 'https:' },
    });
    mocks.settings.serverUrl = 'http://localhost:8787///';

    expect(getServerBaseUrl()).toBe('https://filemint.example.com');
    expect(mocks.settings.update).toHaveBeenCalledWith({ serverUrl: 'https://filemint.example.com' });
  });

  it('returns a local health response with absent capabilities safely defaulted', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:' } });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.startsWith('http://localhost:8787')
        ? health({ ocr: true })
        : new Response('', { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const status = await checkServer(10_000);

    expect(status).toMatchObject({ online: true, version: '1.2.3' });
    expect(status.capabilities.ocr).toBe(true);
    expect(status.capabilities.pdfExport).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('chooses the reachable LAN server advertising the strongest capability set', async () => {
    vi.stubGlobal('window', {
      location: { hostname: '192.168.1.20', protocol: 'https:' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === 'https://192.168.1.20:8787/health') {
          return health({ ocr: true, pdfExport: true, pdfUtility: true }, 'lan-best');
        }
        if (url === 'http://localhost:8787/health') return health({ ocr: true }, 'configured');
        return new Response('', { status: 503 });
      }),
    );

    const status = await checkServer();

    expect(status.version).toBe('lan-best');
    expect(mocks.settings.update).toHaveBeenLastCalledWith({ serverUrl: 'https://192.168.1.20:8787' });
  });

  it('discovers a development host from Expo metadata on Android', async () => {
    mocks.platform.OS = 'android';
    mocks.constants.expoConfig = { hostUri: '10.10.0.5:8081' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input) === 'http://10.10.0.5:8787/health'
          ? health({ pdfRepair: true }, 'device-host')
          : new Response('', { status: 503 }),
      ),
    );

    const status = await checkServer();

    expect(status).toMatchObject({ online: true, version: 'device-host' });
    expect(mocks.settings.update).toHaveBeenLastCalledWith({ serverUrl: 'http://10.10.0.5:8787' });
  });

  it('returns the complete offline shape when every probe fails', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost', protocol: 'http:' } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );

    const status = await checkServer();

    expect(status.online).toBe(false);
    expect(Object.values(status.capabilities)).toEqual(Array(11).fill(false));
    expect(mocks.settings.update).not.toHaveBeenCalled();
  });
});
