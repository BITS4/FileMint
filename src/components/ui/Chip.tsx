import { Pressable, StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';
import { Txt } from './Txt';

export interface ChipProps {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: string;
}

export function Chip({ label, active, onPress, icon }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? theme.primary : theme.backgroundElement,
          borderColor: active ? theme.primary : theme.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}>
      {icon ? <Icon name={icon} size={15} color={active ? theme.primaryText : theme.textSecondary} /> : null}
      <Txt variant="label" style={{ color: active ? theme.primaryText : theme.textSecondary }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
