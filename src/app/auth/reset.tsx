import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, TextField, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/store/useAuth';

type Step = 'request' | 'confirm';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{ email?: string; redirect?: string }>();
  const requestPasswordReset = useAuth((s) => s.requestPasswordReset);
  const confirmPasswordReset = useAuth((s) => s.confirmPasswordReset);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const devCode = useAuth((s) => s.devCode);
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState(String(params.email ?? ''));
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const redirect = useMemo(() => (params.redirect ? String(params.redirect) : '/'), [params.redirect]);
  const loginRoute = `/auth/login?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(redirect)}`;

  const requestCode = async () => {
    try {
      await requestPasswordReset(email);
      setStep('confirm');
      Alert.alert('Reset code sent', 'If the account exists, a reset code was sent to that email.');
    } catch (e) {
      Alert.alert('Could not send reset code', e instanceof Error ? e.message : 'Try again later.');
    }
  };

  const confirm = async () => {
    try {
      await confirmPasswordReset({ email, code, password });
      Alert.alert('Password changed', 'Log in again with your new password.');
      router.replace(loginRoute as never);
    } catch (e) {
      Alert.alert('Reset failed', e instanceof Error ? e.message : 'Could not reset the password.');
    }
  };

  return (
    <Screen scroll padded contentContainerStyle={styles.screen}>
      <AppHeader showBack />
      <View style={styles.hero}>
        <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
          <Icon name="lock-reset" size={38} color={theme.primary} />
        </View>
        <Txt variant="display" center>
          Reset password
        </Txt>
        <Txt variant="caption" muted center>
          Use a 6-digit reset code to create a new password. Old sessions are signed out.
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
        {step === 'confirm' ? (
          <>
            <TextField
              label="Reset code"
              icon="numeric"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="123456"
            />
            <TextField
              label="New password"
              icon="lock-outline"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              placeholder="At least 8 characters"
            />
            <Button
              title={showPassword ? 'Hide password' : 'Show password'}
              icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
              variant="ghost"
              size="sm"
              onPress={() => setShowPassword((v) => !v)}
            />
          </>
        ) : null}
        {devCode ? (
          <View style={[styles.devCode, { backgroundColor: theme.warningMuted }]}>
            <Icon name="email-fast-outline" size={18} color={theme.warning} />
            <Txt variant="caption" style={{ color: theme.warning, flex: 1 }}>
              Local dev reset code: {devCode}
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
        {step === 'request' ? (
          <Button
            title="Send reset code"
            icon="email-send-outline"
            size="lg"
            full
            loading={loading}
            disabled={!email}
            onPress={requestCode}
          />
        ) : (
          <Button
            title="Change password"
            icon="check"
            size="lg"
            full
            loading={loading}
            disabled={!email || code.length !== 6 || !password}
            onPress={confirm}
          />
        )}
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
