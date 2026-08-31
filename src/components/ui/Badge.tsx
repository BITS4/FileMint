import { StyleSheet, View } from 'react-native';

import { Radius } from '@/constants/theme';
import { withAlpha } from '@/lib/color';

import { Txt } from './Txt';

export interface BadgeProps {
  label: string;
  color: string;
  variant?: 'solid' | 'soft' | 'outline';
  small?: boolean;
}

export function Badge({ label, color, variant = 'soft', small }: BadgeProps) {
  const bg = variant === 'solid' ? color : variant === 'soft' ? withAlpha(color, 0.16) : 'transparent';
  const fg = variant === 'solid' ? '#FFFFFF' : color;
  return (
    <View
      style={[
        styles.badge,
        small && styles.small,
        { backgroundColor: bg, borderColor: color, borderWidth: variant === 'outline' ? 1 : 0 },
      ]}
    >
      <Txt variant="tiny" style={{ color: fg, letterSpacing: 0.4 }}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.xs,
    alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 5, paddingVertical: 2 },
});
