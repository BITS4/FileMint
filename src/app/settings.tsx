import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Share, Switch, View } from 'react-native';

import {
  ActionSheet,
  AppHeader,
  Button,
  Card,
  IconButton,
  ListRow,
  PromptModal,
  Screen,
  TextField,
  type SheetAction,
  Txt,
} from '@/components/ui';
import {
  OCR_LANGS,
  PLAN_LABEL,
  QUALITY_LABEL,
  SCAN_LABEL,
  SettingsGroup as Group,
  THEME_LABEL,
  settingsStyles as styles,
  type SettingsPicker as Picker,
} from '@/components/settings/SettingsShared';
import { AboutSettingsGroup } from '@/components/settings/AboutSettingsGroup';
import { type ServerStatus, checkServer } from '@/lib/api';
import { withAlpha } from '@/lib/color';
import { confirm } from '@/lib/confirm';
import { formatBytes } from '@/lib/format';
import { useTheme } from '@/hooks/use-theme';
import { selectIsLoggedIn, selectIsPremium, useAuth } from '@/store/useAuth';
import { useLibrary } from '@/store/useLibrary';
import { type Quality, type ScanColorMode, type ThemeMode, useSettings } from '@/store/useSettings';

export default function SettingsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const settings = useSettings();
  const user = useAuth((s) => s.user);
  const isLoggedIn = useAuth(selectIsLoggedIn);
  const isPremium = useAuth(selectIsPremium);
  const authLoading = useAuth((s) => s.loading);
  const logout = useAuth((s) => s.logout);
  const changePassword = useAuth((s) => s.changePassword);
  const deleteAccount = useAuth((s) => s.deleteAccount);
  const manageSubscription = useAuth((s) => s.manageSubscription);
  const restorePurchases = useAuth((s) => s.restorePurchases);
  const files = useLibrary((s) => s.files);
  const clearLibrary = useLibrary((s) => s.clearLibrary);

  const [picker, setPicker] = useState<Picker>(null);
  const [editingServer, setEditingServer] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [server, setServer] = useState<ServerStatus | null>(null);

  useEffect(() => {
    let alive = true;
    setServer(null);
    checkServer().then((s) => alive && setServer(s));
    return () => {
      alive = false;
    };
  }, [settings.serverUrl]);

  const storageUsed = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const capCount = server?.online ? Object.values(server.capabilities).filter(Boolean).length : 0;
  const ocrLabel = OCR_LANGS.find(([code]) => code === settings.ocrLanguage)?.[1] ?? settings.ocrLanguage;
  const planName = user?.currentPlanId ? (PLAN_LABEL[user.currentPlanId] ?? user.currentPlanId) : 'Free';
  const planExpiry = user?.lifetimePremium
    ? 'Lifetime Premium'
    : user?.premiumExpiresAt
      ? new Date(user.premiumExpiresAt).toLocaleDateString()
      : isPremium
        ? 'Active'
        : 'No active plan';

  const pickerActions: Record<Exclude<Picker, null>, { title: string; actions: SheetAction[] }> = {
    theme: {
      title: 'Appearance',
      actions: (Object.keys(THEME_LABEL) as ThemeMode[]).map((mode) => ({
        label: THEME_LABEL[mode],
        icon:
          settings.themeMode === mode
            ? 'check'
            : mode === 'dark'
              ? 'weather-night'
              : mode === 'light'
                ? 'white-balance-sunny'
                : 'theme-light-dark',
        onPress: () => settings.update({ themeMode: mode }),
      })),
    },
    quality: {
      title: 'Default PDF quality',
      actions: (Object.keys(QUALITY_LABEL) as Quality[]).map((q) => ({
        label: QUALITY_LABEL[q],
        icon: settings.defaultPdfQuality === q ? 'check' : 'quality-high',
        onPress: () => settings.update({ defaultPdfQuality: q }),
      })),
    },
    compression: {
      title: 'Compression level',
      actions: (Object.keys(QUALITY_LABEL) as Quality[]).map((q) => ({
        label: QUALITY_LABEL[q],
        icon: settings.compressionLevel === q ? 'check' : 'arrow-collapse-vertical',
        onPress: () => settings.update({ compressionLevel: q }),
      })),
    },
    scanColor: {
      title: 'Scan color mode',
      actions: (Object.keys(SCAN_LABEL) as ScanColorMode[]).map((m) => ({
        label: SCAN_LABEL[m],
        icon: settings.scanColorMode === m ? 'check' : 'palette-outline',
        onPress: () => settings.update({ scanColorMode: m }),
      })),
    },
    ocr: {
      title: 'OCR language',
      actions: OCR_LANGS.map(([code, label]) => ({
        label,
        icon: settings.ocrLanguage === code ? 'check' : 'translate',
        onPress: () => settings.update({ ocrLanguage: code }),
      })),
    },
  };

  const shareApp = async () => {
    try {
      await Share.share({ message: 'FileMint - read, convert, scan and edit documents.' });
    } catch {
      // user cancelled
    }
  };

  const handleClear = async () => {
    const ok = await confirm(
      'Clear all files?',
      'This permanently deletes every file in FileMint. This cannot be undone.',
      'Delete all',
      true,
    );
    if (ok) await clearLibrary();
  };

  const handleLogout = async () => {
    const ok = await confirm(
      'Log out?',
      'Your local session token will be cleared. You can log in again any time.',
      'Log out',
    );
    if (ok) await logout();
  };

  const handleDeleteAccount = async () => {
    const ok = await confirm(
      'Delete account?',
      'This signs you out and removes the account record from the local FileMint server. This cannot be undone.',
      'Delete account',
      true,
    );
    if (ok) await deleteAccount();
  };

  const handleChangePassword = async () => {
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setChangingPassword(false);
      await confirm(
        'Password changed',
        'Your password was updated. Other active sessions were signed out.',
        'OK',
      );
    } catch (e) {
      await confirm('Could not change password', e instanceof Error ? e.message : 'Try again later.', 'OK');
    }
  };

  const handleManageSubscription = async () => {
    try {
      const message = await manageSubscription();
      await confirm('Subscription', message, 'OK');
    } catch (e) {
      await confirm(
        'Subscription',
        e instanceof Error ? e.message : 'Log in to manage your subscription.',
        'OK',
      );
    }
  };

  const handleRestorePurchases = async () => {
    try {
      const restored = await restorePurchases();
      await confirm(
        restored ? 'Premium restored' : 'No active purchase',
        restored ? 'Your Premium access is active.' : 'No active Premium purchase was found.',
        'OK',
      );
    } catch (e) {
      await confirm('Restore failed', e instanceof Error ? e.message : 'Log in to restore purchases.', 'OK');
    }
  };

  const switchTrack = { false: theme.backgroundSelected, true: withAlpha(theme.primary, 0.6) };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Settings" showBack />

      <Card onPress={() => router.push('/upgrade')} style={[styles.upgrade, { borderColor: theme.primary }]}>
        <View style={[styles.upgradeIcon, { backgroundColor: withAlpha(theme.primary, 0.18) }]}>
          <IconButton name="crown-outline" color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="h3">{isPremium ? 'FileMint Premium' : 'Upgrade to Premium'}</Txt>
          <Txt variant="caption" muted>
            {isPremium ? planExpiry : 'Remove ads, unlock OCR, batch tools, and premium PDF editing'}
          </Txt>
        </View>
        <IconButton name="chevron-right" color={theme.textMuted} />
      </Card>

      <Group title="Account">
        {isLoggedIn && user ? (
          <>
            <ListRow
              icon="account-circle-outline"
              title={user.fullName || user.email}
              subtitle={
                user.username ? `@${user.username} · ${user.email}` : user.fullName ? user.email : 'Signed in'
              }
              value={user.emailVerified ? 'Verified' : 'Unverified'}
            />
            <ListRow
              icon={user.emailVerified ? 'email-check-outline' : 'email-alert-outline'}
              iconColor={user.emailVerified ? theme.success : theme.warning}
              title="Email verification"
              subtitle={
                user.emailVerified ? 'Your email is confirmed.' : 'Confirm your email before buying Premium.'
              }
              value={user.emailVerified ? 'Done' : 'Needed'}
              onPress={
                user.emailVerified
                  ? undefined
                  : () => router.push(`/auth/verify?email=${encodeURIComponent(user.email)}`)
              }
              showChevron={!user.emailVerified}
            />
            <ListRow
              icon="crown-outline"
              iconColor={theme.primary}
              title="Current plan"
              subtitle={planExpiry}
              value={planName}
            />
            <ListRow
              icon="credit-card-cog-outline"
              title="Upgrade / manage subscription"
              onPress={isPremium ? handleManageSubscription : () => router.push('/upgrade')}
              showChevron
            />
            <ListRow icon="restore" title="Restore purchases" onPress={handleRestorePurchases} showChevron />
            <ListRow
              icon="lock-reset"
              title="Change password"
              onPress={() => setChangingPassword((v) => !v)}
              showChevron
            />
            {changingPassword ? (
              <View style={styles.passwordPanel}>
                <TextField
                  label="Current password"
                  icon="lock-outline"
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  secureTextEntry
                  autoCapitalize="none"
                />
                <TextField
                  label="New password"
                  icon="lock-check-outline"
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  hint="At least 8 characters with a letter and a number."
                />
                <Button
                  title="Save password"
                  icon="check"
                  loading={authLoading}
                  disabled={!currentPassword || !newPassword}
                  onPress={handleChangePassword}
                />
              </View>
            ) : null}
            <ListRow icon="logout" title="Logout" onPress={handleLogout} showChevron />
            <ListRow
              icon="account-remove-outline"
              title="Delete account"
              destructive
              onPress={handleDeleteAccount}
              showChevron
            />
          </>
        ) : (
          <>
            <ListRow
              icon="account-outline"
              title="Not signed in"
              subtitle="Log in to manage Premium, sessions, and account security."
            />
            <View style={styles.authButtons}>
              <Button
                title="Log in"
                icon="login"
                onPress={() => router.push('/auth/login')}
                style={{ flex: 1 }}
              />
              <Button
                title="Sign up"
                icon="account-plus-outline"
                variant="secondary"
                onPress={() => router.push('/auth/signup')}
                style={{ flex: 1 }}
              />
            </View>
          </>
        )}
      </Group>

      <Group title="General">
        <ListRow
          icon="theme-light-dark"
          title="Appearance"
          value={THEME_LABEL[settings.themeMode]}
          onPress={() => setPicker('theme')}
          showChevron
        />
        <ListRow
          icon="quality-high"
          title="Default PDF quality"
          value={QUALITY_LABEL[settings.defaultPdfQuality]}
          onPress={() => setPicker('quality')}
          showChevron
        />
        <ListRow
          icon="arrow-collapse-vertical"
          title="Compression level"
          value={QUALITY_LABEL[settings.compressionLevel]}
          onPress={() => setPicker('compression')}
          showChevron
        />
        <ListRow
          icon="translate"
          title="OCR language"
          value={ocrLabel}
          onPress={() => setPicker('ocr')}
          showChevron
        />
      </Group>

      <Group title="Scanning">
        <ListRow
          icon="palette-outline"
          title="Scan color mode"
          value={SCAN_LABEL[settings.scanColorMode]}
          onPress={() => setPicker('scanColor')}
          showChevron
        />
        <ListRow
          icon="auto-fix"
          title="Auto-enhance scans"
          right={
            <Switch
              value={settings.scanAutoEnhance}
              onValueChange={(v) => settings.update({ scanAutoEnhance: v })}
              trackColor={switchTrack}
              thumbColor={settings.scanAutoEnhance ? theme.primary : '#f4f4f5'}
            />
          }
        />
      </Group>

      <Group title="Conversion server">
        <ListRow
          icon={server?.online ? 'server-network' : 'server-network-off'}
          iconColor={server?.online ? theme.success : theme.textMuted}
          title="Server address"
          subtitle={
            server === null
              ? 'Checking...'
              : server.online
                ? `Online - ${capCount} engine${capCount === 1 ? '' : 's'} available`
                : 'Offline - tap to set the address'
          }
          value={settings.serverUrl.replace(/^https?:\/\//, '')}
          onPress={() => setEditingServer(true)}
          showChevron
        />
      </Group>

      <Group title="Security">
        <ListRow
          icon="lock-outline"
          title="App lock"
          subtitle="Require unlock to open FileMint"
          right={
            <Switch
              value={settings.appLockEnabled}
              onValueChange={(v) => settings.update({ appLockEnabled: v })}
              trackColor={switchTrack}
              thumbColor={settings.appLockEnabled ? theme.primary : '#f4f4f5'}
            />
          }
        />
      </Group>

      <Group title="Storage">
        <ListRow icon="harddisk" title="Storage used" value={formatBytes(storageUsed)} />
        <ListRow
          icon="trash-can-outline"
          title="Clear all files"
          subtitle={`${files.length} item${files.length === 1 ? '' : 's'}`}
          destructive
          onPress={handleClear}
        />
      </Group>

      <Group title="Support">
        <ListRow icon="share-variant" title="Share FileMint" onPress={shareApp} showChevron />
        <ListRow
          icon="message-text-outline"
          title="Send feedback"
          onPress={() => router.push('/feedback')}
          showChevron
        />
        <ListRow
          icon="lightbulb-outline"
          title="Request a feature"
          onPress={() => router.push('/feedback?type=feature')}
          showChevron
        />
      </Group>

      <AboutSettingsGroup />

      <ActionSheet
        visible={picker !== null}
        onClose={() => setPicker(null)}
        title={picker ? pickerActions[picker].title : undefined}
        actions={picker ? pickerActions[picker].actions : []}
      />
      <PromptModal
        visible={editingServer}
        title="Conversion server"
        message="Point this at the FileMint server. On a real device use your computer's LAN IP, e.g. http://192.168.1.20:8787"
        initialValue={settings.serverUrl}
        placeholder="http://localhost:8787"
        submitLabel="Save"
        onSubmit={(value) => {
          const url = value.trim();
          if (url) settings.update({ serverUrl: url });
          setEditingServer(false);
        }}
        onClose={() => setEditingServer(false)}
      />
    </Screen>
  );
}
