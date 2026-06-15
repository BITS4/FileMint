import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { type AccentName, Accents, Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { kindMeta } from '@/lib/format';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

import { Icon } from './Icon';

export interface ThumbnailProps {
  file: FileItem;
  size?: number;
  radius?: number;
  fill?: boolean;
}

export function Thumbnail({ file, size = 50, radius = Radius.sm, fill }: ThumbnailProps) {
  const theme = useTheme();
  const meta = kindMeta(file.kind);
  const color = Accents[meta.accent as AccentName];
  const [uri, setUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    if (file.kind === 'image') {
      storage
        .getUri(file.storageKey)
        .then((u) => alive && setUri(u))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
  }, [file.storageKey, file.kind]);

  const box = fill
    ? ({ width: '100%' as const, aspectRatio: 1, borderRadius: radius })
    : ({ width: size, height: size, borderRadius: radius });

  if (file.kind === 'image' && uri) {
    return <Image source={{ uri }} style={[box, { backgroundColor: theme.backgroundElement }]} resizeMode="cover" />;
  }

  const iconSize = fill ? 40 : size * 0.5;
  return (
    <View style={[styles.chip, box, { backgroundColor: withAlpha(color, 0.16) }]}>
      <Icon name={meta.icon} size={iconSize} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
});
