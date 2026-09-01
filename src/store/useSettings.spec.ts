import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  asyncStorage: { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() },
  platform: { OS: 'web' },
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: mocks.asyncStorage }));
vi.mock('react-native', () => ({ Platform: mocks.platform }));

describe('settings store defaults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.platform.OS = 'web';
    mocks.asyncStorage.getItem.mockReset().mockResolvedValue(null);
    mocks.asyncStorage.removeItem.mockReset().mockResolvedValue(undefined);
    mocks.asyncStorage.setItem.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses localhost during local development and applies partial updates', async () => {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } });
    const { DEFAULT_SERVER_URL, useSettings } = await import('./useSettings');

    expect(DEFAULT_SERVER_URL).toBe('http://localhost:8787');
    expect(useSettings.getState()).toMatchObject({
      themeMode: 'dark',
      defaultPdfQuality: 'high',
      ocrLanguage: 'eng',
      serverUrl: 'http://localhost:8787',
      premium: false,
    });
    useSettings.getState().update({ themeMode: 'light', ocrLanguage: 'tgk' });
    expect(useSettings.getState()).toMatchObject({ themeMode: 'light', ocrLanguage: 'tgk' });
  });

  it('uses the normalized configured production server for a public web host', async () => {
    vi.stubEnv('EXPO_PUBLIC_FILEMINT_SERVER_URL', 'https://api.filemint.example///');
    vi.stubGlobal('window', { location: { hostname: 'filemint.example' } });
    const { DEFAULT_SERVER_URL, PRODUCTION_SERVER_URL } = await import('./useSettings');

    expect(PRODUCTION_SERVER_URL).toBe('https://api.filemint.example');
    expect(DEFAULT_SERVER_URL).toBe('https://api.filemint.example');
  });

  it('keeps private LAN web sessions pointed at the local conversion service', async () => {
    vi.stubGlobal('window', { location: { hostname: '172.20.1.5' } });
    const { DEFAULT_SERVER_URL } = await import('./useSettings');
    expect(DEFAULT_SERVER_URL).toBe('http://localhost:8787');
  });
});
