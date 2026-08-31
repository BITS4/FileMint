import { Pressable, StyleSheet, View } from 'react-native';

import { type AccentName, Accents, Radius, Spacing, elevation } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';

import { Badge } from './Badge';
import { Icon } from './Icon';
import { Txt } from './Txt';

export interface FeatureTileProps {
  title: string;
  subtitle?: string;
  icon: string;
  accent: AccentName;
  onPress?: () => void;
  badge?: string;
  locked?: boolean;
}

export function FeatureTile({ title, subtitle, icon, accent, onPress, badge, locked }: FeatureTileProps) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const color = Accents[accent];
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.tile,
        desktop && styles.desktopTile,
        {
          backgroundColor: pressed ? theme.backgroundElement : theme.card,
          borderColor: pressed ? theme.borderStrong : theme.border,
          opacity: pressed ? 0.9 : 1,
          alignItems: desktop ? 'flex-start' : 'center',
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        !desktop && elevation(1),
      ]}
    >
      <View style={[styles.accentLine, { backgroundColor: color }]} />
      {badge ? (
        <View style={styles.badge}>
          <Badge label={badge} color={Accents.amber} variant="soft" small />
        </View>
      ) : null}
      <View style={[styles.iconChip, { backgroundColor: withAlpha(color, 0.16) }]}>
        <Icon name={locked ? 'crown-outline' : icon} size={26} color={locked ? Accents.amber : color} />
      </View>
      <Txt variant="label" numberOfLines={2} style={!desktop ? styles.title : undefined}>
        {title}
      </Txt>
      {subtitle ? (
        <Txt variant="tiny" muted numberOfLines={1}>
          {subtitle}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: '100%',
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    alignItems: 'center',
    gap: 4,
    minHeight: 104,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  accentLine: { position: 'absolute', left: 12, right: 12, top: 0, height: 3, borderRadius: Radius.pill },
  desktopTile: {
    minHeight: 132,
    justifyContent: 'space-between',
  },
  iconChip: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: { textAlign: 'center' },
  badge: { position: 'absolute', top: 8, right: 8 },
});
