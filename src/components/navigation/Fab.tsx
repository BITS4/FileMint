import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Radius, elevation } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';

import { Icon } from '@/components/ui/Icon';

export interface FabProps {
  onPress: () => void;
  bottom: number;
  icon?: string;
}

export function Fab({ onPress, bottom, icon = 'plus' }: FabProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Create or import"
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.fab,
        elevation(2) as ViewStyle,
        { backgroundColor: theme.primary, bottom, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      <Icon name={icon} size={30} color={theme.primaryText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
});
