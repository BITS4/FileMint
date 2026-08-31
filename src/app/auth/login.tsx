import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, TextField, Txt } from '@/components/ui';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { ApiError } from '@/lib/auth-api';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/useAuth';

function routeWithRedirect(path: string, redirect?: string, email?: string) {
  const params = new URLSearchParams();
  if (redirect) params.set('redirect', redirect);
  if (email) params.set('email', email);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ redirect?: string; email?: string }>();
  const login = useAuth((s) => s.login);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const redirect = useMemo(() => (params.redirect ? String(params.redirect) : '/'), [params.redirect]);

  const submit = async () => {
    try {
      await login({ email, password });
      router.replace(redirect as never);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        router.replace(routeWithRedirect('/auth/verify', redirect, email) as never);
        return;
      }
      Alert.alert('Login failed', e instanceof Error ? e.message : 'Could not log in.');
    }
  };

  return (
    <Screen scroll padded contentContainerStyle={styles.screen}>
      <AppHeader showBack />
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
          <Icon name="shield-account-outline" size={38} color={theme.primary} />
        </View>
        <Txt variant="display" center>
          Welcome back
        </Txt>
        <Txt variant="caption" muted center>
          Log in to save your account, manage Premium, and keep your document tools protected.
        </Txt>
      </View>

      <Card style={styles.card}>
        <TextField
          label="Email"
          icon="email-outline"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="you@example.com"
        />
        <TextField
          label="Password"
          icon="lock-outline"
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          placeholder="Your password"
        />
        <Button
          title={showPassword ? 'Hide password' : 'Show password'}
          icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
          variant="ghost"
          size="sm"
          onPress={() => setShowPassword((v) => !v)}
        />
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.dangerMuted }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Txt variant="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}
        <Button
          title="Log in"
          icon="login"
          size="lg"
          full
          loading={loading}
          disabled={!email || !password}
          onPress={submit}
        />
        <Button
          title="Forgot password?"
          variant="ghost"
          onPress={() => router.push(routeWithRedirect('/auth/reset', redirect, email) as never)}
        />
      </Card>

      <Card style={styles.alt}>
        <View style={[styles.smallIcon, { backgroundColor: withAlpha(Accents.sky, 0.15) }]}>
          <Icon name="account-plus-outline" size={22} color={Accents.sky} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">New to FileMint?</Txt>
          <Txt variant="caption" muted>
            Create a verified account before buying Premium.
          </Txt>
        </View>
        <Button
          title="Sign up"
          size="sm"
          variant="secondary"
          onPress={() => router.push(routeWithRedirect('/auth/signup', redirect, email) as never)}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 40, maxWidth: 560, alignSelf: 'center', width: '100%' },
  hero: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, marginBottom: Spacing.lg },
  heroIcon: {
    width: 78,
    height: 78,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: { gap: Spacing.md },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  alt: { marginTop: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  smallIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
