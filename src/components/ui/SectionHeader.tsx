import { Pressable, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface SectionHeaderProps {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, actionLabel, onAction }: SectionHeaderProps) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Txt variant="h3">{title}</Txt>
      {actionLabel && onAction ? (
        <Pressable
          style={styles.action}
          onPress={() => {
            haptics.tap();
            onAction();
          }}>
          <Txt variant="label" style={{ color: theme.primary }}>
            {actionLabel}
          </Txt>
          <Icon name="chevron-right" size={16} color={theme.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    marginTop: Spacing.lg,
  },
  action: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
