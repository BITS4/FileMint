import { Pressable, StyleSheet, View } from 'react-native';

import { type AccentName, Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, kindMeta } from '@/lib/format';
import * as haptics from '@/lib/haptics';
import type { FileItem } from '@/types';

import { Badge } from './Badge';
import { Icon } from './Icon';
import { Thumbnail } from './Thumbnail';
import { Txt } from './Txt';

export interface FileGridItemProps {
  file: FileItem;
  onPress: () => void;
  onMore?: () => void;
}

export function FileGridItem({ file, onPress, onMore }: FileGridItemProps) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const meta = kindMeta(file.kind);
  const color = Accents[meta.accent as AccentName];

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        desktop && styles.desktopCard,
        { backgroundColor: theme.card, borderColor: theme.border, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View>
        <Thumbnail file={file} fill radius={Radius.md} />
        <View style={styles.badge}>
          <Badge label={meta.label} color={color} variant="solid" small />
        </View>
        {file.favorite ? (
          <View style={[styles.star, { backgroundColor: theme.overlay }]}>
            <Icon name="star" size={13} color={theme.warning} />
          </View>
        ) : null}
        {onMore ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              haptics.tap();
              onMore();
            }}
            style={[styles.more, { backgroundColor: theme.overlay }]}>
            <Icon name="dots-horizontal" size={16} color="#FFFFFF" />
          </Pressable>
        ) : null}
      </View>
      <Txt variant="label" numberOfLines={1} style={styles.name}>
        {file.name}
      </Txt>
      <Txt variant="tiny" muted numberOfLines={1}>
        {formatBytes(file.size)}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Radius.lg, borderWidth: 1, padding: Spacing.sm, gap: 3 },
  desktopCard: { padding: Spacing.md, gap: Spacing.xs },
  badge: { position: 'absolute', left: 6, top: 6 },
  star: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { marginTop: Spacing.xs },
});
