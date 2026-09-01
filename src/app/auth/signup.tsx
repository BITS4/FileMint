import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, TextField, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { buildAuthRoute, safeInternalRedirect } from '@/lib/auth-navigation';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/useAuth';

export default function SignupScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ redirect?: string; email?: string }>();
  const signup = useAuth((s) => s.signup);
  const checkUsername = useAuth((s) => s.checkUsername);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const devCode = useAuth((s) => s.devCode);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{
    state: 'idle' | 'checking' | 'ok' | 'bad';
    message: string;
  }>({
    state: 'idle',
    message: 'At least 6 characters. Letters, numbers, and underscore only.',
  });

  const redirect = useMemo(() => safeInternalRedirect(params.redirect), [params.redirect]);
  const canSubmit =
    !!fullName.trim() && !!phone.trim() && !!email.trim() && !!password && usernameStatus.state === 'ok';

  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (!value) {
      setUsernameStatus({
        state: 'idle',
        message: 'At least 6 characters. Letters, numbers, and underscore only.',
      });
      return;
    }
    if (value.length < 6) {
      setUsernameStatus({ state: 'bad', message: 'Username must be at least 6 characters.' });
      return;
    }
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      setUsernameStatus({ state: 'bad', message: 'Only letters, numbers, and underscore are allowed.' });
      return;
    }

    let canceled = false;
    setUsernameStatus({ state: 'checking', message: 'Checking username...' });
    const timer = setTimeout(() => {
      checkUsername(value)
        .then((res) => {
          if (canceled) return;
          setUsernameStatus({ state: res.valid && res.available ? 'ok' : 'bad', message: res.message });
        })
        .catch((e) => {
          if (canceled) return;
          setUsernameStatus({
            state: 'bad',
            message: e instanceof Error ? e.message : 'Could not check this username.',
          });
        });
    }, 350);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [checkUsername, username]);

  const submit = async () => {
    try {
      await signup({
        email,
        password,
        fullName: fullName.trim(),
        phone: phone.trim(),
        username: username.trim().toLowerCase(),
      });
      router.replace(buildAuthRoute('/auth/verify', { email, redirect }) as never);
    } catch (e) {
      Alert.alert('Sign up failed', e instanceof Error ? e.message : 'Could not create your account.');
    }
  };

  return (
    <Screen scroll padded contentContainerStyle={styles.screen}>
      <AppHeader showBack />
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
          <Icon name="account-heart-outline" size={38} color={theme.primary} />
        </View>
        <Txt variant="display" center>
          Create account
        </Txt>
        <Txt variant="caption" muted center>
          Verify your email to unlock account features and buy Premium safely.
        </Txt>
      </View>

      <Card style={styles.card}>
        <TextField
          label="Full name"
          icon="account-outline"
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your legal name"
        />
        <TextField
          label="Phone"
          icon="phone-outline"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="+1 555 123 4567"
        />
        <TextField
          label="Username"
          icon="account-circle-outline"
          value={username}
          onChangeText={(value) => setUsername(value.replace(/\s+/g, '').toLowerCase())}
          autoCapitalize="none"
          placeholder="vazir_2026"
          hint={usernameStatus.message}
        />
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
          placeholder="At least 8 characters"
          hint="Use at least one letter and one number."
        />
        <Button
          title={showPassword ? 'Hide password' : 'Show password'}
          icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
          variant="ghost"
          size="sm"
          onPress={() => setShowPassword((v) => !v)}
        />
        {devCode ? <DevCode code={devCode} /> : null}
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.dangerMuted }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Txt variant="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}
        <Button
          title="Sign up"
          icon="account-plus-outline"
          size="lg"
          full
          loading={loading || usernameStatus.state === 'checking'}
          disabled={!canSubmit}
          onPress={submit}
        />
        <Button
          title="Already have an account?"
          variant="ghost"
          onPress={() => router.replace(buildAuthRoute('/auth/login', { email, redirect }) as never)}
        />
      </Card>
    </Screen>
  );
}

function DevCode({ code }: { code: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.devCode, { backgroundColor: theme.warningMuted }]}>
      <Icon name="email-fast-outline" size={18} color={theme.warning} />
      <Txt variant="caption" style={{ color: theme.warning, flex: 1 }}>
        Local dev email code: {code}
      </Txt>
    </View>
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
  devCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
});
