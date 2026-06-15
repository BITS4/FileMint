/**
 * Resolves the active palette from the user's theme preference (Settings),
 * falling back to the system color scheme when set to "system". FileMint is
 * dark-first, so an unknown system scheme defaults to dark.
 */
import { Colors, type Palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/store/useSettings';

export function useThemeName(): 'dark' | 'light' {
  const scheme = useColorScheme();
  const mode = useSettings((s) => s.themeMode);
  if (mode === 'dark' || mode === 'light') return mode;
  return scheme === 'light' ? 'light' : 'dark';
}

export function useTheme(): Palette {
  return Colors[useThemeName()];
}
