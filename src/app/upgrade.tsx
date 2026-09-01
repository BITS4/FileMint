import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, Badge, Button, Card, Icon, Screen, Txt } from '@/components/ui';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { findTool } from '@/constants/tools';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '@/constants/legal';
import type { PlanId, PremiumPlan } from '@/lib/auth-api';
import { buildAuthRoute, safeInternalRedirect } from '@/lib/auth-navigation';
import { withAlpha } from '@/lib/color';
import { goBack } from '@/lib/nav';
import { useTheme } from '@/hooks/use-theme';
import { selectIsLoggedIn, selectIsPremium, useAuth } from '@/store/useAuth';

const FALLBACK_PLANS: PremiumPlan[] = [
  {
    id: 'week',
    name: '1 Week Plan',
    shortName: '1 Week',
    price: '$0.99',
    amountCents: 99,
    durationLabel: '7 days',
  },
  {
    id: 'month',
    name: '1 Month Plan',
    shortName: '1 Month',
    price: '$4.99',
    amountCents: 499,
    durationLabel: '1 month',
  },
  {
    id: 'year',
    name: '1 Year Plan',
    shortName: '1 Year',
    price: '$49.99',
    amountCents: 4999,
    durationLabel: '1 year',
    bestValue: true,
  },
  {
    id: 'forever',
    name: 'Forever Plan',
    shortName: 'Forever',
    price: '$199.99',
    amountCents: 19999,
    durationLabel: 'lifetime access',
  },
];

const BENEFITS = [
  'Unlimited or higher-limit conversions',
  'PDF to Word with OCR and editable tables',
  'Office to PDF, PDF to Excel, and PDF to PowerPoint',
  'Advanced crop, scan, OCR, filters, and compression',
  'Manage pages, signatures, redaction, locks, and watermarks',
  'No ads and priority server processing',
];

export default function UpgradeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const params = useLocalSearchParams<{
    redirect?: string;
    lockedTool?: string;
    checkout?: string;
    session_id?: string;
  }>();
  const user = useAuth((s) => s.user);
  const plansFromStore = useAuth((s) => s.plans);
  const loading = useAuth((s) => s.loading);
  const error = useAuth((s) => s.error);
  const loadPlans = useAuth((s) => s.loadPlans);
  const buyPlan = useAuth((s) => s.buyPlan);
  const confirmCheckout = useAuth((s) => s.confirmCheckout);
  const restorePurchases = useAuth((s) => s.restorePurchases);
  const manageSubscription = useAuth((s) => s.manageSubscription);
  const isLoggedIn = useAuth(selectIsLoggedIn);
  const isPremium = useAuth(selectIsPremium);
  const [selected, setSelected] = useState<PlanId>('year');
  const [confirmingSession, setConfirmingSession] = useState(false);
  const handledCheckoutRef = useRef<string | null>(null);

  const redirect = useMemo(() => safeInternalRedirect(params.redirect), [params.redirect]);
  const lockedTool = findTool(params.lockedTool ? String(params.lockedTool) : null);
  const plans = plansFromStore.length ? plansFromStore : FALLBACK_PLANS;

  useEffect(() => {
    loadPlans().catch(() => undefined);
  }, [loadPlans]);

  useEffect(() => {
    const checkout = params.checkout ? String(params.checkout) : '';
    const sessionId = params.session_id ? String(params.session_id) : '';
    const key = `${checkout}:${sessionId}`;
    if (!checkout || handledCheckoutRef.current === key) return;
    if (checkout === 'cancel') {
      handledCheckoutRef.current = key;
      Alert.alert('Payment canceled', 'Your Premium purchase was not completed.');
      return;
    }
    if (checkout !== 'success' || !sessionId || confirmingSession || !isLoggedIn) return;
    handledCheckoutRef.current = key;
    setConfirmingSession(true);
    confirmCheckout(sessionId)
      .then(() => {
        Alert.alert('Premium unlocked', 'Stripe confirmed your payment. Your Premium plan is active now.');
        router.replace(redirect as never);
      })
      .catch((e) =>
        Alert.alert(
          'Payment confirmation failed',
          e instanceof Error ? e.message : 'Could not confirm this Stripe checkout.',
        ),
      )
      .finally(() => setConfirmingSession(false));
  }, [confirmCheckout, confirmingSession, isLoggedIn, params.checkout, params.session_id, redirect, router]);

  const authRoute = (path: '/auth/login' | '/auth/signup') =>
    buildAuthRoute(path, {
      redirect: `/upgrade?redirect=${encodeURIComponent(redirect)}${lockedTool ? `&lockedTool=${encodeURIComponent(lockedTool.id)}` : ''}`,
    });

  const continueToPayment = async () => {
    if (!isLoggedIn) {
      router.push(authRoute('/auth/login') as never);
      return;
    }
    if (!user?.emailVerified) {
      router.push(
        buildAuthRoute('/auth/verify', { email: user?.email ?? '', redirect: '/upgrade' }) as never,
      );
      return;
    }
    try {
      const res = await buyPlan(selected);
      if (res.checkoutUrl) {
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.location.assign(res.checkoutUrl);
        } else {
          await WebBrowser.openBrowserAsync(res.checkoutUrl);
        }
        return;
      }
      if (res.verified) {
        Alert.alert('Premium unlocked', 'Your Premium plan is active now.');
        router.replace(redirect as never);
      }
    } catch (e) {
      Alert.alert('Payment failed', e instanceof Error ? e.message : 'Could not verify the purchase.');
    }
  };

  const restore = async () => {
    if (!isLoggedIn) {
      router.push(authRoute('/auth/login') as never);
      return;
    }
    try {
      const restored = await restorePurchases();
      Alert.alert(
        restored ? 'Premium restored' : 'No active purchase',
        restored
          ? 'Your Premium access is active.'
          : 'No active Premium purchase was found for this account.',
      );
    } catch (e) {
      Alert.alert('Restore failed', e instanceof Error ? e.message : 'Could not restore purchases.');
    }
  };

  const manage = async () => {
    try {
      const message = await manageSubscription();
      Alert.alert('Subscription', message);
    } catch (e) {
      Alert.alert('Subscription', e instanceof Error ? e.message : 'Could not open subscription management.');
    }
  };

  return (
    <Screen scroll padded contentContainerStyle={styles.screen}>
      <AppHeader showBack onBack={goBack} />
      <View style={styles.hero}>
        <View style={[styles.crown, { backgroundColor: withAlpha(Accents.amber, 0.18) }]}>
          <Icon name="crown" size={42} color={Accents.amber} />
        </View>
        <Txt variant="display" center>
          Upgrade to Premium
        </Txt>
        <Txt variant="caption" muted center style={styles.heroCopy}>
          {lockedTool
            ? `${lockedTool.title} is a Premium tool. Upgrade once and keep the workflow moving.`
            : 'Unlock the full FileMint conversion and PDF editing studio.'}
        </Txt>
      </View>

      {isPremium ? (
        <Card style={[styles.currentPlan, { borderColor: theme.primary }]}>
          <Icon name="check-decagram" size={24} color={theme.primary} />
          <View style={{ flex: 1 }}>
            <Txt variant="h3">Premium is active</Txt>
            <Txt variant="caption" muted>
              {user?.lifetimePremium
                ? 'Lifetime Premium'
                : user?.premiumExpiresAt
                  ? `Expires ${new Date(user.premiumExpiresAt).toLocaleDateString()}`
                  : 'Active plan'}
            </Txt>
          </View>
          <Button title="Continue" size="sm" onPress={() => router.replace(redirect as never)} />
        </Card>
      ) : null}

      <Card style={styles.benefits}>
        {BENEFITS.map((benefit) => (
          <View key={benefit} style={styles.benefit}>
            <Icon name="check-circle" size={20} color={theme.primary} />
            <Txt variant="caption" style={{ flex: 1 }}>
              {benefit}
            </Txt>
          </View>
        ))}
      </Card>

      <View style={styles.planGrid}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={selected === plan.id}
            onPress={() => setSelected(plan.id)}
          />
        ))}
      </View>

      {error ? (
        <View style={[styles.error, { backgroundColor: theme.dangerMuted }]}>
          <Icon name="alert-circle-outline" size={18} color={theme.danger} />
          <Txt variant="caption" style={{ color: theme.danger, flex: 1 }}>
            {error}
          </Txt>
        </View>
      ) : null}

      <View style={styles.actions}>
        {!isLoggedIn ? (
          <View style={styles.authActions}>
            <Button
              title="Log in to upgrade"
              icon="login"
              onPress={() => router.push(authRoute('/auth/login') as never)}
              style={{ flex: 1 }}
            />
            <Button
              title="Sign up"
              icon="account-plus-outline"
              variant="secondary"
              onPress={() => router.push(authRoute('/auth/signup') as never)}
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <Button
            title="Pay with card"
            icon="credit-card-check-outline"
            size="lg"
            full
            loading={loading || confirmingSession}
            disabled={isPremium}
            onPress={continueToPayment}
          />
        )}
        <View style={styles.secondaryActions}>
          <Button
            title="Restore purchase"
            icon="restore"
            variant="secondary"
            onPress={restore}
            style={{ flex: 1 }}
          />
          <Button
            title="Manage subscription"
            icon="cog-outline"
            variant="secondary"
            onPress={manage}
            style={{ flex: 1 }}
          />
        </View>
        <Button title="Maybe Later" variant="ghost" onPress={goBack} />
        <View style={styles.legal}>
          <Txt variant="tiny" muted onPress={() => void WebBrowser.openBrowserAsync(TERMS_OF_USE_URL)}>
            Terms
          </Txt>
          <Txt variant="tiny" muted>
            |
          </Txt>
          <Txt variant="tiny" muted onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)}>
            Privacy
          </Txt>
        </View>
      </View>
    </Screen>
  );
}

function PlanCard({
  plan,
  selected,
  onPress,
}: {
  plan: PremiumPlan;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.plan,
        {
          backgroundColor: selected ? withAlpha(theme.primary, 0.14) : theme.card,
          borderColor: selected ? theme.primary : theme.border,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}
    >
      <View style={styles.planTop}>
        <Txt variant="h3">{plan.shortName}</Txt>
        {plan.bestValue ? <Badge label="Best value" color={Accents.amber} variant="soft" small /> : null}
      </View>
      <Txt variant="display">{plan.price}</Txt>
      <Txt variant="caption" muted>
        {plan.durationLabel}
      </Txt>
      <View style={styles.radioRow}>
        <Icon
          name={selected ? 'radiobox-marked' : 'radiobox-blank'}
          size={20}
          color={selected ? theme.primary : theme.textMuted}
        />
        <Txt variant="tiny" muted>
          {selected ? 'Selected' : 'Choose plan'}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: 44, maxWidth: 880, alignSelf: 'center', width: '100%' },
  hero: { alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm, marginBottom: Spacing.lg },
  crown: { width: 84, height: 84, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { maxWidth: 580 },
  currentPlan: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  benefits: { gap: Spacing.md, marginBottom: Spacing.lg },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  planGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  plan: {
    flexGrow: 1,
    flexBasis: 190,
    minHeight: 154,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  radioRow: { marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
  },
  actions: { marginTop: Spacing.xl, gap: Spacing.md },
  authActions: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' },
  secondaryActions: { flexDirection: 'row', gap: Spacing.md, flexWrap: 'wrap' },
  legal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
});
