import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Share, StyleSheet, Switch, View } from 'react-native';

import {
  ActionSheet,
  AppHeader,
  Card,
  IconButton,
  ListRow,
  PromptModal,
  Screen,
  SectionHeader,
  type SheetAction,
  Txt,
} from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { type ServerStatus, checkServer } from '@/lib/api';
import { withAlpha } from '@/lib/color';
import { confirm } from '@/lib/confirm';
import { formatBytes } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';
import { useLibrary } from '@/store/useLibrary';
import { type Quality, type ScanColorMode, type ThemeMode, useSettings } from '@/store/useSettings';

type Picker = 'theme' | 'quality' | 'compression' | 'ocr' | 'scanColor' | null;

const THEME_LABEL: Record<ThemeMode, string> = { system: 'System', dark: 'Dark', light: 'Light' };
const QUALITY_LABEL: Record<Quality, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const SCAN_LABEL: Record<ScanColorMode, string> = { color: 'Color', grayscale: 'Grayscale', bw: 'Black & White' };
const OCR_LANGS: [string, string][] = [
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <SectionHeader title={title} />
      <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
        {children}
      </Card>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const settings = useSettings();
  const files = useLibrary((s) => s.files);
  const clearLibrary = useLibrary((s) => s.clearLibrary);

  const [picker, setPicker] = useState<Picker>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [server, setServer] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let alive = true;
    setServer(null);
    checkServer().then((s) => alive && setServer(s));
    return () => {
      alive = false;
    };
  }, [settings.serverUrl]);

  const storageUsed = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const capCount = server?.online
    ? Object.values(server.capabilities).filter(Boolean).length
    : 0;
  const ocrLabel = OCR_LANGS.find(([code]) => code === settings.ocrLanguage)?.[1] ?? settings.ocrLanguage;

  const pickerActions: Record<Exclude<Picker, null>, { title: string; actions: SheetAction[] }> = {
    theme: {
      title: 'Appearance',
      actions: (Object.keys(THEME_LABEL) as ThemeMode[]).map((mode) => ({
        label: THEME_LABEL[mode],
        icon: settings.themeMode === mode ? 'check' : mode === 'dark' ? 'weather-night' : mode === 'light' ? 'white-balance-sunny' : 'theme-light-dark',
        onPress: () => settings.update({ themeMode: mode }),
      })),
    },
    quality: {
      title: 'Default PDF quality',
      actions: (Object.keys(QUALITY_LABEL) as Quality[]).map((q) => ({
        label: QUALITY_LABEL[q],
        icon: settings.defaultPdfQuality === q ? 'check' : 'quality-high',
        onPress: () => settings.update({ defaultPdfQuality: q }),
      })),
    },
    compression: {
      title: 'Compression level',
      actions: (Object.keys(QUALITY_LABEL) as Quality[]).map((q) => ({
        label: QUALITY_LABEL[q],
        icon: settings.compressionLevel === q ? 'check' : 'arrow-collapse-vertical',
        onPress: () => settings.update({ compressionLevel: q }),
      })),
    },
    scanColor: {
      title: 'Scan color mode',
      actions: (Object.keys(SCAN_LABEL) as ScanColorMode[]).map((m) => ({
        label: SCAN_LABEL[m],
        icon: settings.scanColorMode === m ? 'check' : 'palette-outline',
        onPress: () => settings.update({ scanColorMode: m }),
      })),
    },
    ocr: {
      title: 'OCR language',
      actions: OCR_LANGS.map(([code, label]) => ({
        label,
        icon: settings.ocrLanguage === code ? 'check' : 'translate',
        onPress: () => settings.update({ ocrLanguage: code }),
      })),
    },
  };

  const shareApp = async () => {
    try {
      await Share.share({ message: 'FileMint - read, convert, scan and edit documents.' });
    } catch {
      // user cancelled
    }
  };

  const handleClear = async () => {
    const ok = await confirm('Clear all files?', 'This permanently deletes every file in FileMint. This cannot be undone.', 'Delete all', true);
    if (ok) await clearLibrary();
  };

  const switchTrack = { false: theme.backgroundSelected, true: withAlpha(theme.primary, 0.6) };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Settings" showBack />

      <Card onPress={() => router.push('/upgrade')} style={[styles.upgrade, { borderColor: theme.primary }]}>
        <View style={[styles.upgradeIcon, { backgroundColor: withAlpha(theme.primary, 0.18) }]}>
          <IconButton name="crown-outline" color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">FileMint Pro</Txt>
          <Txt variant="caption" muted>
            {settings.premium ? 'Thanks for being Pro!' : 'Remove ads & unlock everything'}
          </Txt>
        </View>
        <IconButton name="chevron-right" color={theme.textMuted} />
      </Card>

      <Group title="General">
        <ListRow icon="theme-light-dark" title="Appearance" value={THEME_LABEL[settings.themeMode]} onPress={() => setPicker('theme')} showChevron />
        <ListRow icon="quality-high" title="Default PDF quality" value={QUALITY_LABEL[settings.defaultPdfQuality]} onPress={() => setPicker('quality')} showChevron />
        <ListRow icon="arrow-collapse-vertical" title="Compression level" value={QUALITY_LABEL[settings.compressionLevel]} onPress={() => setPicker('compression')} showChevron />
        <ListRow icon="translate" title="OCR language" value={ocrLabel} onPress={() => setPicker('ocr')} showChevron />
      </Group>

      <Group title="Scanning">
        <ListRow icon="palette-outline" title="Scan color mode" value={SCAN_LABEL[settings.scanColorMode]} onPress={() => setPicker('scanColor')} showChevron />
        <ListRow
          icon="auto-fix"
          title="Auto-enhance scans"
          right={
            <Switch
              value={settings.scanAutoEnhance}
              onValueChange={(v) => settings.update({ scanAutoEnhance: v })}
              trackColor={switchTrack}
              thumbColor={settings.scanAutoEnhance ? theme.primary : '#f4f4f5'}
            />
          }
        />
      </Group>

      <Group title="Conversion server">
        <ListRow
          icon={server?.online ? 'server-network' : 'server-network-off'}
          iconColor={server?.online ? theme.success : theme.textMuted}
          title="Server address"
          subtitle={
            server === null
              ? 'Checking...'
              : server.online
                ? `Online - ${capCount} engine${capCount === 1 ? '' : 's'} available`
                : 'Offline - tap to set the address'
          }
          value={settings.serverUrl.replace(/^https?:\/\//, '')}
          onPress={() => setEditingServer(true)}
          showChevron
        />
      </Group>

      <Group title="Security">
        <ListRow
          icon="lock-outline"
          title="App lock"
          subtitle="Require unlock to open FileMint"
          right={
            <Switch
              value={settings.appLockEnabled}
              onValueChange={(v) => settings.update({ appLockEnabled: v })}
              trackColor={switchTrack}
              thumbColor={settings.appLockEnabled ? theme.primary : '#f4f4f5'}
            />
          }
        />
      </Group>

      <Group title="Storage">
        <ListRow icon="harddisk" title="Storage used" value={formatBytes(storageUsed)} />
        <ListRow icon="trash-can-outline" title="Clear all files" subtitle={`${files.length} item${files.length === 1 ? '' : 's'}`} destructive onPress={handleClear} />
      </Group>

      <Group title="Support">
        <ListRow icon="share-variant" title="Share FileMint" onPress={shareApp} showChevron />
        <ListRow icon="message-text-outline" title="Send feedback" onPress={() => router.push('/feedback')} showChevron />
        <ListRow icon="lightbulb-outline" title="Request a feature" onPress={() => router.push('/feedback?type=feature')} showChevron />
      </Group>

      <Group title="About">
        <ListRow icon="shield-check-outline" title="Privacy policy" onPress={() => void WebBrowser.openBrowserAsync('https://example.com/privacy')} showChevron />
        <ListRow icon="file-document-outline" title="Terms of service" onPress={() => void WebBrowser.openBrowserAsync('https://example.com/terms')} showChevron />
        <ListRow icon="information-outline" title="Version" value={Constants.expoConfig?.version ?? '1.0.0'} />
      </Group>

      <ActionSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker ? pickerActions[picker].title : undefined}
        actions={picker ? pickerActions[picker].actions : []}
      />
      <PromptModal
        visible={editingServer}
        title="Conversion server"
        message="Point this at the FileMint server. On a real device use your computer's LAN IP, e.g. http://192.168.1.20:8788"
        initialValue={settings.serverUrl}
        placeholder="http://localhost:8788"
        submitLabel="Save"
        onSubmit={(value) => {
          const url = value.trim();
          if (url) settings.update({ serverUrl: url });
          setEditingServer(false);
        }}
        onClose={() => setEditingServer(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  upgrade: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  upgradeIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
});
