import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ThemeMode = 'system' | 'dark' | 'light';
export type Quality = 'high' | 'medium' | 'low';
export type ScanColorMode = 'color' | 'grayscale' | 'bw';

export interface SettingsState {
  themeMode: ThemeMode;
  defaultPdfQuality: Quality;
  compressionLevel: Quality;
  ocrLanguage: string;
  scanColorMode: ScanColorMode;
  scanAutoEnhance: boolean;
  appLockEnabled: boolean;
  defaultExportFolderId: string | null;
  serverUrl: string;
  premium: boolean;
  hasSeenIntro: boolean;
  hydrated: boolean;
  update: (patch: Partial<Omit<SettingsState, 'update' | 'hydrated'>>) => void;
}

export const PRODUCTION_SERVER_URL =
  process.env.EXPO_PUBLIC_FILEMINT_SERVER_URL?.replace(/\/+$/, '') || 'https://filemint-docker.onrender.com';

function isHostedWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return !!host && host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && !/^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Default conversion-server origin. Production web points at the hosted
 *  Render conversion stack; local/dev still defaults to localhost. */
export const DEFAULT_SERVER_URL = isHostedWeb() ? PRODUCTION_SERVER_URL : 'http://localhost:8788';

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      defaultPdfQuality: 'high',
      compressionLevel: 'medium',
      ocrLanguage: 'eng',
      scanColorMode: 'color',
      scanAutoEnhance: true,
      appLockEnabled: false,
      defaultExportFolderId: null,
      serverUrl: DEFAULT_SERVER_URL,
      premium: false,
      hasSeenIntro: false,
      hydrated: false,
      update: (patch) => set(patch),
    }),
    {
      name: 'filemint-settings',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ update: _u, hydrated: _h, ...rest }) => rest,
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);
