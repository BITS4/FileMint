import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, SectionHeader } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import type { Quality, ScanColorMode, ThemeMode } from '@/store/useSettings';

export type SettingsPicker = 'theme' | 'quality' | 'compression' | 'ocr' | 'scanColor' | null;

export const THEME_LABEL: Record<ThemeMode, string> = { system: 'System', dark: 'Dark', light: 'Light' };
export const QUALITY_LABEL: Record<Quality, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const SCAN_LABEL: Record<ScanColorMode, string> = {
  color: 'Color',
  grayscale: 'Grayscale',
  bw: 'Black & White',
};
export const OCR_LANGS: [string, string][] = [
  ['eng', 'English'],
  ['spa', 'Spanish'],
  ['fra', 'French'],
  ['deu', 'German'],
  ['ita', 'Italian'],
  ['por', 'Portuguese'],
  ['rus', 'Russian'],
  ['chi_sim', 'Chinese (Simplified)'],
  ['jpn', 'Japanese'],
  ['ara', 'Arabic'],
  ['hin', 'Hindi'],
];

export const PLAN_LABEL: Record<string, string> = {
  week: '1 Week Plan',
  month: '1 Month Plan',
  year: '1 Year Plan',
  forever: 'Forever Plan',
};

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View>
      <SectionHeader title={title} />
      <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
        {children}
      </Card>
    </View>
  );
}

export const settingsStyles = StyleSheet.create({
  upgrade: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  upgradeIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authButtons: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingBottom: Spacing.sm,
    flexWrap: 'wrap',
  },
  passwordPanel: { gap: Spacing.md, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.md },
});
