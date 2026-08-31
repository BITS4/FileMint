import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { goBack } from '@/lib/nav';

import { IconButton } from './IconButton';
import { Txt } from './Txt';

export interface AppHeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: ReactNode;
  large?: boolean;
}

export function AppHeader({ title, subtitle, showBack, onBack, right, large }: AppHeaderProps) {
  const handleBack = () => (onBack ? onBack() : goBack());
  return (
    <View style={[styles.row, large && styles.large]}>
      <View style={styles.left}>
        {showBack ? (
          <IconButton
            name="chevron-left"
            size={28}
            onPress={handleBack}
            accessibilityLabel="Back"
            style={styles.back}
          />
        ) : null}
        <View style={styles.titles}>
          {title ? (
            <Txt variant={large ? 'display' : 'h2'} numberOfLines={1}>
              {title}
            </Txt>
          ) : null}
          {subtitle ? (
            <Txt variant="caption" muted numberOfLines={1}>
              {subtitle}
            </Txt>
          ) : null}
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    minHeight: 56,
    gap: Spacing.sm,
  },
  large: { paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  left: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: Spacing.xs },
  back: { marginLeft: -8 },
  titles: { flex: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
