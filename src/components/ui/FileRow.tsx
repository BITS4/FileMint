import { Pressable, StyleSheet, View } from 'react-native';

import { type AccentName, Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, formatPages, formatRelativeDate, kindMeta } from '@/lib/format';
import * as haptics from '@/lib/haptics';
import type { FileItem } from '@/types';

import { Badge } from './Badge';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Thumbnail } from './Thumbnail';
import { Txt } from './Txt';

export interface FileRowProps {
  file: FileItem;
  onPress: () => void;
  onMore?: () => void;
  onShare?: () => void;
}

export function FileRow({ file, onPress, onMore, onShare }: FileRowProps) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const meta = kindMeta(file.kind);
  const color = Accents[meta.accent as AccentName];
  const metaText = [formatRelativeDate(file.modifiedAt), formatBytes(file.size), formatPages(file.pageCount)]
    .filter(Boolean)
    .join('   ·   ');

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        desktop && styles.desktopRow,
        {
          backgroundColor: pressed ? theme.backgroundElement : desktop ? theme.card : 'transparent',
          borderColor: desktop ? theme.border : 'transparent',
        },
      ]}>
      <Thumbnail file={file} size={desktop ? 54 : 50} />
      <View style={styles.body}>
        <Txt variant="body" weight="600" numberOfLines={1}>
          {file.name}
        </Txt>
        <View style={styles.metaRow}>
          <Badge label={meta.label} color={color} variant="solid" small />
          <Txt variant="tiny" muted numberOfLines={1} style={styles.metaText}>
            {metaText}
          </Txt>
        </View>
      </View>
      {file.favorite ? <Icon name="star" size={16} color={theme.warning} /> : null}
      {onShare ? <IconButton name="share-variant" size={18} color={theme.textSecondary} onPress={onShare} /> : null}
      {onMore ? <IconButton name="dots-vertical" size={20} color={theme.textSecondary} onPress={onMore} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  desktopRow: {
    minHeight: 72,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  body: { flex: 1, gap: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  metaText: { flexShrink: 1 },
});
