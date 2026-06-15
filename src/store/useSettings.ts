import AsyncStorage from '@react-native-async-storage/async-storage';
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

/** Default conversion-server origin. Editable in Settings; on a physical
 *  device point this at the dev machine's LAN IP instead of localhost. */
export const DEFAULT_SERVER_URL = 'http://localhost:8788';

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
