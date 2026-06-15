import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface ListRowProps {
  icon?: string;
  iconColor?: string;
  title: string;
  subtitle?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  showChevron?: boolean;
  destructive?: boolean;
}

export function ListRow({
  icon,
  iconColor,
  title,
  subtitle,
  value,
  right,
  onPress,
  showChevron,
  destructive,
}: ListRowProps) {
  const theme = useTheme();
  const tint = destructive ? theme.danger : iconColor ?? theme.primary;
  const titleColor = destructive ? theme.danger : theme.text;

  const content = (
    <>
      {icon ? (
        <View style={[styles.iconChip, { backgroundColor: withAlpha(tint, 0.16) }]}>
          <Icon name={icon} size={20} color={tint} />
        </View>
      ) : null}
      <View style={styles.body}>
        <Txt variant="body" weight="600" style={{ color: titleColor }} numberOfLines={1}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="caption" muted numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="caption" muted numberOfLines={1} style={styles.value}>
          {value}
        </Txt>
      ) : null}
      {right}
      {showChevron ? <Icon name="chevron-right" size={20} color={theme.textMuted} /> : null}
    </>
  );

  if (!onPress) {
    return <View style={styles.row}>{content}</View>;
  }
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.backgroundElement : 'transparent' }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 1 },
  value: { maxWidth: 140, textAlign: 'right' },
});
