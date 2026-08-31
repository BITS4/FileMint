import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, TextField, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/useAuth';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ email?: string; code?: string; redirect?: string }>();
  const verifyEmail = useAuth((s) => s.verifyEmail);
  const resendCode = useAuth((s) => s.resendCode);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const devCode = useAuth((s) => s.devCode);
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [code, setCode] = useState(String(params.code ?? ''));
  const redirect = useMemo(() => (params.redirect ? String(params.redirect) : '/'), [params.redirect]);

  const loginRoute = `/auth/login?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`;

  const submit = async () => {
    try {
      await verifyEmail({ email, code });
      Alert.alert('Email verified', 'You can now log in and use your verified FileMint account.');
      router.replace(loginRoute as never);
    } catch (e) {
      Alert.alert('Verification failed', e instanceof Error ? e.message : 'Could not verify this code.');
    }
  };

  const resend = async () => {
    try {
      await resendCode(email);
      Alert.alert('Code sent', 'Check your email for the new 6-digit code.');
    } catch (e) {
      Alert.alert('Could not resend code', e instanceof Error ? e.message : 'Try again later.');
    }
  };

  return (
    <Screen scroll padded contentContainerStyle={styles.screen}>
      <AppHeader showBack />
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
          <Icon name="email-check-outline" size={38} color={theme.primary} />
        </View>
        <Txt variant="display" center>
          Verify your email
        </Txt>
        <Txt variant="caption" muted center>
          Enter the 6-digit code. Codes expire after 10 minutes.
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
        />
        <TextField
          label="Confirmation code"
          icon="numeric"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="123456"
        />
        {devCode ? (
          <View style={[styles.devCode, { backgroundColor: theme.warningMuted }]}>
            <Icon name="email-fast-outline" size={18} color={theme.warning} />
            <Txt variant="caption" style={{ color: theme.warning, flex: 1 }}>
              Local dev email code: {devCode}
            </Txt>
          </View>
        ) : null}
        {error ? (
          <View style={[styles.error, { backgroundColor: theme.dangerMuted }]}>
            <Icon name="alert-circle-outline" size={18} color={theme.danger} />
            <Txt variant="caption" style={{ color: theme.danger, flex: 1 }}>
              {error}
            </Txt>
          </View>
        ) : null}
        <Button
          title="Verify email"
          icon="check-decagram-outline"
          size="lg"
          full
          loading={loading}
          disabled={!email || code.length !== 6}
          onPress={submit}
        />
        <Button
          title="Resend code"
          icon="email-sync-outline"
          variant="secondary"
          onPress={resend}
          disabled={!email || loading}
        />
        <Button title="Back to login" variant="ghost" onPress={() => router.replace(loginRoute as never)} />
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
  devCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
});
