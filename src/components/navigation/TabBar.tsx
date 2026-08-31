import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, TAB_BAR_HEIGHT, elevation } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as haptics from '@/lib/haptics';
import { withAlpha } from '@/lib/color';

import { Icon } from '@/components/ui/Icon';
import { Txt } from '@/components/ui/Txt';

interface NavLike {
  navigate: (name: string) => void;
  emit: (event: { type: string; target?: string; canPreventDefault?: boolean }) => {
    defaultPrevented: boolean;
  };
}

export interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: NavLike;
  descriptors: Record<string, { options: { title?: string } }>;
}

const ICONS: Record<string, { on: string; off: string; label: string }> = {
  index: { on: 'home-variant', off: 'home-variant-outline', label: 'Home' },
  files: { on: 'folder', off: 'folder-outline', label: 'Files' },
  convert: { on: 'swap-horizontal-bold', off: 'swap-horizontal', label: 'Convert' },
  edit: { on: 'square-edit-outline', off: 'square-edit-outline', label: 'Edit' },
  tools: { on: 'view-grid', off: 'view-grid-outline', label: 'Tools' },
};

export function TabBar({ state, navigation, descriptors }: TabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.wrap,
        {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View
        style={[
          styles.bar,
          elevation(2),
          {
            backgroundColor: theme.tabBar,
            borderColor: theme.tabBarBorder,
          },
        ]}
      >
        {state.routes.map((route, index) => {
          const meta = ICONS[route.name] ?? { on: 'circle', off: 'circle-outline', label: route.name };
          const label = descriptors[route.key]?.options.title ?? meta.label;
          const focused = state.index === index;

          return (
            <TabButton
              key={route.key}
              focused={focused}
              label={label}
              icon={focused ? meta.on : meta.off}
              onPress={() => {
                haptics.tap();
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

function TabButton({
  focused,
  label,
  icon,
  onPress,
}: {
  focused: boolean;
  label: string;
  icon: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const active = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(active, {
      toValue: focused ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [active, focused]);

  const color = focused ? theme.primary : theme.tabInactive;
  const railScale = active.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const labelY = active.interpolate({ inputRange: [0, 1], outputRange: [1, -1] });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      style={styles.tab}
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.iconRail,
          {
            backgroundColor: focused ? theme.primaryMuted : 'transparent',
            borderColor: focused ? withAlpha(theme.primary, 0.26) : 'transparent',
            transform: [{ scale: railScale }],
          },
        ]}
      >
        <Icon name={icon} size={22} color={color} />
      </Animated.View>
      <Animated.View style={{ transform: [{ translateY: labelY }], maxWidth: '100%' }}>
        <Txt variant="tiny" numberOfLines={1} style={{ color, marginTop: 2, maxWidth: '100%' }}>
          {label}
        </Txt>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.xs,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bar: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: Radius.xl,
    minHeight: TAB_BAR_HEIGHT - 10,
    paddingHorizontal: Spacing.xs,
    width: '100%',
    maxWidth: '100%',
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    flexBasis: 0,
    flexShrink: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
  },
  iconRail: {
    minWidth: 42,
    height: 28,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
