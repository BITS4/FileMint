import { type ReactNode } from 'react';
import { Pressable, View, type ViewStyle } from 'react-native';

import { Radius, Spacing, elevation } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

export interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  padded?: boolean;
  elevated?: boolean;
}

export function Card({ children, onPress, style, padded = true, elevated }: CardProps) {
  const theme = useTheme();
  const base: (ViewStyle | false | undefined)[] = [
    { backgroundColor: theme.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: theme.border },
    padded ? { padding: Spacing.lg } : undefined,
    elevated ? (elevation(1) as ViewStyle) : undefined,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        style={({ pressed }) => [...base, { opacity: pressed ? 0.85 : 1 }, style as ViewStyle]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[...base, style as ViewStyle]}>{children}</View>;
}
