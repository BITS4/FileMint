import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton, Txt } from '@/components/ui';
import { Accents, DESKTOP_SIDEBAR_WIDTH, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';
import { useLibrary } from '@/store/useLibrary';

interface DesktopSidebarProps {
  onCreate: () => void;
}

const ITEMS = [
  { href: '/', label: 'Home', icon: 'home-variant-outline', activeIcon: 'home-variant' },
  { href: '/files', label: 'Files', icon: 'folder-outline', activeIcon: 'folder' },
  { href: '/convert', label: 'Convert', icon: 'swap-horizontal', activeIcon: 'swap-horizontal-bold' },
  { href: '/edit', label: 'Edit PDF', icon: 'square-edit-outline', activeIcon: 'square-edit-outline' },
  { href: '/tools', label: 'Tools', icon: 'view-grid-outline', activeIcon: 'view-grid' },
] as const;

function isActive(pathname: string, href: string) {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DesktopSidebar({ onCreate }: DesktopSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const files = useLibrary((s) => s.files.filter((f) => !f.trashed).length);

  return (
    <View
      style={[
        styles.shell,
        {
          paddingTop: Math.max(insets.top, Spacing.xl),
          paddingBottom: Math.max(insets.bottom, Spacing.lg),
          backgroundColor: theme.backgroundElevated,
          borderRightColor: theme.border,
        },
      ]}>
      <View style={styles.brandRow}>
        <View style={[styles.brandMark, { backgroundColor: theme.primary }]}>
          <Icon name="file-document-multiple" size={24} color={theme.primaryText} />
        </View>
        <View style={styles.brandText}>
          <Txt variant="h2" numberOfLines={1}>
            FileMint
          </Txt>
          <Txt variant="tiny" muted numberOfLines={1}>
            {files} {files === 1 ? 'file' : 'files'}
          </Txt>
        </View>
        <IconButton name="magnify" variant="surface" onPress={() => router.push('/search')} accessibilityLabel="Search" />
      </View>

      <Button title="New / Import" icon="plus" onPress={onCreate} full style={styles.createButton} />

      <View style={styles.nav}>
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Pressable
              key={item.href}
              accessibilityRole="button"
              accessibilityState={active ? { selected: true } : undefined}
              onPress={() => {
                haptics.tap();
                router.push(item.href);
              }}
              style={({ pressed }) => [
                styles.navItem,
                {
                  backgroundColor: active ? theme.primaryMuted : pressed ? theme.backgroundElement : 'transparent',
                  borderColor: active ? withAlpha(theme.primary, 0.38) : 'transparent',
                },
              ]}>
              <View style={[styles.navIcon, { backgroundColor: active ? withAlpha(theme.primary, 0.16) : theme.backgroundElement }]}>
                <Icon name={active ? item.activeIcon : item.icon} size={21} color={active ? theme.primary : theme.textSecondary} />
              </View>
              <Txt variant="label" weight="700" style={{ color: active ? theme.text : theme.textSecondary }}>
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.bottom}>
        <View style={[styles.statusCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={[styles.statusDot, { backgroundColor: Accents.teal }]} />
          <View style={{ flex: 1 }}>
            <Txt variant="label" numberOfLines={1}>
              Conversion server
            </Txt>
            <Txt variant="tiny" muted numberOfLines={1}>
              Local workspace
            </Txt>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings')}
          style={({ pressed }) => [
            styles.settings,
            { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
          ]}>
          <Icon name="cog-outline" size={20} color={theme.textSecondary} />
          <Txt variant="label" muted>
            Settings
          </Txt>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: DESKTOP_SIDEBAR_WIDTH,
    borderRightWidth: 1,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: { flex: 1 },
  createButton: { marginTop: Spacing.xs },
  nav: { gap: Spacing.xs },
  navItem: {
    minHeight: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  navIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { marginTop: 'auto', gap: Spacing.sm },
  statusCard: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  statusDot: { width: 9, height: 9, borderRadius: Radius.pill },
  settings: {
    minHeight: 46,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
});
