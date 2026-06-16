import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, TextField, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/useAuth';

function verifyRoute(email: string, redirect?: string) {
  const params = new URLSearchParams({ email });
  if (redirect) params.set('redirect', redirect);
  return `/auth/verify?${params.toString()}`;
}

export default function SignupScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ redirect?: string; email?: string }>();
  const signup = useAuth((s) => s.signup);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const devCode = useAuth((s) => s.devCode);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const redirect = useMemo(() => (params.redirect ? String(params.redirect) : '/'), [params.redirect]);

  const submit = async () => {
    try {
      await signup({ email, password, fullName, phone });
      router.replace(verifyRoute(email, redirect) as never);
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
        <TextField label="Full name" icon="account-outline" value={fullName} onChangeText={setFullName} placeholder="Optional" />
        <TextField label="Phone" icon="phone-outline" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Optional" />
        <TextField label="Email" icon="email-outline" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" />
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
        <Button title={showPassword ? 'Hide password' : 'Show password'} icon={showPassword ? 'eye-off-outline' : 'eye-outline'} variant="ghost" size="sm" onPress={() => setShowPassword((v) => !v)} />
        {devCode ? <DevCode code={devCode} /> : null}
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.dangerMuted }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Txt variant="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}
        <Button title="Sign up" icon="account-plus-outline" size="lg" full loading={loading} disabled={!email || !password} onPress={submit} />
        <Button title="Already have an account?" variant="ghost" onPress={() => router.replace(`/auth/login?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}` as never)} />
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
  heroIcon: { width: 78, height: 78, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  card: { gap: Spacing.md },
  error: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  devCode: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
});
