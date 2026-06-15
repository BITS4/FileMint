import { Tabs } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CreateSheet } from '@/components/navigation/CreateSheet';
import { DesktopSidebar } from '@/components/navigation/DesktopSidebar';
import { Fab } from '@/components/navigation/Fab';
import { TabBar, type TabBarProps } from '@/components/navigation/TabBar';
import { TAB_BAR_HEIGHT } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const [createOpen, setCreateOpen] = useState(false);
  const desktop = useIsDesktop();
  const theme = useTheme();

  if (desktop) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background }}>
        <DesktopSidebar onCreate={() => setCreateOpen(true)} />
        <View style={{ flex: 1 }}>
          <Tabs screenOptions={{ headerShown: false }} tabBar={() => null}>
            <Tabs.Screen name="index" options={{ title: 'Home' }} />
            <Tabs.Screen name="files" options={{ title: 'Files' }} />
            <Tabs.Screen name="convert" options={{ title: 'Convert' }} />
            <Tabs.Screen name="edit" options={{ title: 'Edit' }} />
            <Tabs.Screen name="tools" options={{ title: 'Tools' }} />
          </Tabs>
        </View>
        <CreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...(props as unknown as TabBarProps)} />}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="files" options={{ title: 'Files' }} />
        <Tabs.Screen name="convert" options={{ title: 'Convert' }} />
        <Tabs.Screen name="edit" options={{ title: 'Edit' }} />
        <Tabs.Screen name="tools" options={{ title: 'Tools' }} />
      </Tabs>
      <Fab onPress={() => setCreateOpen(true)} bottom={TAB_BAR_HEIGHT + insets.bottom + 16} />
      <CreateSheet visible={createOpen} onClose={() => setCreateOpen(false)} />
    </View>
  );
}
