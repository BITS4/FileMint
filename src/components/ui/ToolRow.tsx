import { Pressable, StyleSheet, View } from 'react-native';

import { STATUS_LABEL } from '@/constants/tools';
import { type AccentName, Accents, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';
import type { ToolDef, ToolStatus } from '@/types';

import { Badge } from './Badge';
import { Icon } from './Icon';
import { Txt } from './Txt';

export interface ToolRowProps {
  tool: ToolDef;
  onPress: () => void;
}

export function ToolRow({ tool, onPress }: ToolRowProps) {
  const theme = useTheme();
  const color = Accents[tool.accent as AccentName];
  const statusColor: Record<ToolStatus, string> = {
    ready: theme.success,
    beta: theme.warning,
    backend: theme.info,
    soon: theme.textMuted,
  };

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
      ]}
    >
      <View style={[styles.chip, { backgroundColor: withAlpha(color, 0.16) }]}>
        <Icon name={tool.icon} size={22} color={color} />
      </View>
      <View style={styles.body}>
        <Txt variant="body" weight="600" numberOfLines={1}>
          {tool.title}
        </Txt>
        {tool.subtitle ? (
          <Txt variant="caption" muted numberOfLines={1}>
            {tool.subtitle}
          </Txt>
        ) : null}
      </View>
      {tool.status !== 'ready' ? (
        <Badge label={STATUS_LABEL[tool.status]} color={statusColor[tool.status]} variant="soft" small />
      ) : null}
      {tool.premium ? <Badge label="Premium" color={Accents.amber} variant="soft" small /> : null}
      <Icon name="chevron-right" size={20} color={theme.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  chip: { width: 42, height: 42, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 1 },
});
