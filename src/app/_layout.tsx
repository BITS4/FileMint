import 'react-native-gesture-handler';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useThemeName } from '@/hooks/use-theme';
import * as storage from '@/lib/storage';

export default function RootLayout() {
  const name = useThemeName();
  const palette = Colors[name];

  useEffect(() => {
    storage.init().catch(() => undefined);
  }, []);

  const base = name === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: palette.background,
      card: palette.background,
      text: palette.text,
      border: palette.border,
      primary: palette.primary,
      notification: palette.danger,
    },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={navTheme}>
          <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: palette.background },
            }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="settings" />
            <Stack.Screen name="search" options={{ presentation: 'modal', animation: 'fade' }} />
            <Stack.Screen name="upgrade" options={{ presentation: 'modal' }} />
            <Stack.Screen name="feedback" options={{ presentation: 'modal' }} />
            <Stack.Screen name="viewer/[id]" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
