import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { DesktopContentWidth, MaxContentWidth, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /** Horizontal padding via the standard gutter. */
  padded?: boolean;
  edges?: Edge[];
  contentContainerStyle?: ViewStyle;
  style?: ViewStyle;
  /** Pinned footer rendered outside the scroll area. */
  footer?: ReactNode;
}

/**
 * Page shell: themed background, safe-area handling and a centered max-width
 * column so the app reads well on wide web / tablet layouts too.
 */
export function Screen({
  children,
  scroll,
  padded,
  edges = ['top'],
  contentContainerStyle,
  style,
  footer,
}: ScreenProps) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const { width } = useWindowDimensions();
  const gutter = padded ? { paddingHorizontal: desktop ? Spacing.xxl : Spacing.lg } : null;
  const maxWidth = Math.min(desktop ? DesktopContentWidth : MaxContentWidth, width || MaxContentWidth);

  const inner = <View style={[styles.column, { maxWidth }, gutter, contentContainerStyle]}>{children}</View>;

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.background }, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, desktop ? styles.desktopScrollContent : null]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{inner}</View>
      )}
      {footer ? (
        <View style={[styles.footer, padded ? { paddingHorizontal: Spacing.lg } : null]}>
          <View style={[styles.footerColumn, { maxWidth }]}>{footer}</View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, width: '100%' },
  desktopScrollContent: { paddingTop: Spacing.lg, paddingBottom: Spacing.xxl },
  column: { width: '100%', minWidth: 0, alignSelf: 'center', flex: 1 },
  footerColumn: { width: '100%', alignSelf: 'center' },
  footer: { width: '100%' },
});
