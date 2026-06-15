import { StyleSheet, View } from 'react-native';

import { AppHeader, Button, Card, Icon, Screen, Txt } from '@/components/ui';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { withAlpha } from '@/lib/color';
import { goBack } from '@/lib/nav';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/store/useSettings';

const BENEFITS: { icon: string; title: string; subtitle: string }[] = [
  { icon: 'block-helper', title: 'No ads', subtitle: 'A clean, distraction-free workspace' },
  { icon: 'infinity', title: 'Unlimited conversions', subtitle: 'No daily limits on any tool' },
  { icon: 'layers-triple-outline', title: 'Batch processing', subtitle: 'Convert and edit many files at once' },
  { icon: 'text-recognition', title: 'Premium OCR', subtitle: 'More languages and higher accuracy' },
  { icon: 'cloud-upload-outline', title: 'Cloud backup', subtitle: 'Sync your library across devices' },
];

export default function UpgradeScreen() {
  const theme = useTheme();
  const premium = useSettings((s) => s.premium);
  const update = useSettings((s) => s.update);

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader showBack onBack={goBack} />
      <View style={styles.hero}>
        <View style={[styles.crown, { backgroundColor: withAlpha(Accents.amber, 0.18) }]}>
          <Icon name="crown" size={40} color={Accents.amber} />
        </View>
        <Txt variant="display" center style={{ marginTop: Spacing.md }}>
          FileMint Pro
        </Txt>
        <Txt variant="body" muted center style={{ marginTop: 4 }}>
          Everything unlocked. One simple upgrade.
        </Txt>
      </View>

      <Card style={{ gap: Spacing.lg, marginTop: Spacing.lg }}>
        {BENEFITS.map((b) => (
          <View key={b.title} style={styles.benefit}>
            <View style={[styles.benefitIcon, { backgroundColor: withAlpha(theme.primary, 0.16) }]}>
              <Icon name={b.icon} size={20} color={theme.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="body" weight="600">
                {b.title}
              </Txt>
              <Txt variant="caption" muted>
                {b.subtitle}
              </Txt>
            </View>
            <Icon name="check-circle" size={20} color={theme.primary} />
          </View>
        ))}
      </Card>

      <View style={{ marginTop: Spacing.xl, gap: Spacing.sm }}>
        <Button
          title={premium ? "You're Pro 🎉" : 'Go Pro'}
          icon={premium ? 'check' : 'crown-outline'}
          disabled={premium}
          full
          size="lg"
          onPress={() => update({ premium: true })}
        />
        {premium ? (
          <Button title="Cancel Pro (demo)" variant="ghost" full onPress={() => update({ premium: false })} />
        ) : (
          <Txt variant="tiny" muted center>
            Demo upgrade — no payment is taken in this build.
          </Txt>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: Spacing.lg },
  crown: { width: 84, height: 84, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  benefitIcon: { width: 38, height: 38, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
});
