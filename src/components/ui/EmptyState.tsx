import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Button } from './Button';
import { Icon } from './Icon';
import { Txt } from './Txt';

export interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction, compact }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={[styles.circle, { backgroundColor: theme.primaryMuted }]}>
        <Icon name={icon} size={34} color={theme.primary} />
      </View>
      <Txt variant="h3" center>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="caption" muted center style={styles.subtitle}>
          {subtitle}
        </Txt>
      ) : null}
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} size="md" style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: Spacing.sm },
  compact: { flex: 0, paddingVertical: Spacing.huge },
  circle: {
    width: 76,
    height: 76,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  subtitle: { maxWidth: 280 },
  action: { marginTop: Spacing.md, paddingHorizontal: Spacing.xxl },
});
