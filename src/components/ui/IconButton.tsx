import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from './Icon';

export interface IconButtonProps {
  name: string;
  size?: number;
  color?: string;
  onPress?: () => void;
  variant?: 'plain' | 'surface';
  set?: 'mc' | 'ion';
  style?: ViewStyle;
  accessibilityLabel?: string;
  disabled?: boolean;
}

export function IconButton({
  name,
  size = 22,
  color,
  onPress,
  variant = 'plain',
  set,
  style,
  accessibilityLabel,
  disabled,
}: IconButtonProps) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        haptics.tap();
        onPress?.();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        variant === 'surface' && { backgroundColor: theme.backgroundElement },
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
        style,
      ]}
    >
      <Icon name={name} size={size} color={color ?? theme.text} set={set} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
