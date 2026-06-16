import 'react-native-gesture-handler';

import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Alert } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useThemeName } from '@/hooks/use-theme';
import * as storage from '@/lib/storage';
import { useAuth } from '@/store/useAuth';

export default function RootLayout() {
  const name = useThemeName();
  const palette = Colors[name];
  const authHydrated = useAuth((s) => s.hydrated);
  const token = useAuth((s) => s.token);
  const sessionExpiresAt = useAuth((s) => s.sessionExpiresAt);
  const sessionWarningAt = useAuth((s) => s.sessionWarningAt);
  const refreshMe = useAuth((s) => s.refreshMe);
  const logout = useAuth((s) => s.logout);

  useEffect(() => {
    storage.init().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!authHydrated || !token) return;
    refreshMe().catch(() => undefined);
  }, [authHydrated, refreshMe, token]);

  useEffect(() => {
    if (!token || !sessionExpiresAt) return;
    const expiresAt = new Date(sessionExpiresAt).getTime();
    const warningAt = sessionWarningAt ? new Date(sessionWarningAt).getTime() : expiresAt - 5 * 60 * 1000;
    const now = Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (warningAt > now) {
      timers.push(
        setTimeout(() => {
          Alert.alert('Your session will expire soon.', 'For your privacy, FileMint will ask you to log in again shortly.');
        }, warningAt - now),
      );
    }

    timers.push(
      setTimeout(() => {
        logout().finally(() => router.replace('/auth/login'));
      }, Math.max(0, expiresAt - now)),
    );

    return () => timers.forEach(clearTimeout);
  }, [logout, sessionExpiresAt, sessionWarningAt, token]);

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
            <Stack.Screen name="auth/login" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/signup" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/verify" options={{ presentation: 'modal' }} />
            <Stack.Screen name="auth/reset" options={{ presentation: 'modal' }} />
            <Stack.Screen name="feedback" options={{ presentation: 'modal' }} />
            <Stack.Screen name="viewer/[id]" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
