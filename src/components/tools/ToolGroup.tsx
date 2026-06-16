import { Pressable, StyleSheet, View } from 'react-native';

import { Badge, Card, Icon, SectionHeader, TileGrid, ToolRow, Txt } from '@/components/ui';
import { STATUS_LABEL } from '@/constants/tools';
import { type AccentName, Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';
import type { ToolDef, ToolStatus } from '@/types';

export interface ToolGroupProps {
  title: string;
  tools: ToolDef[];
  onOpen: (tool: ToolDef) => void;
}

export function ToolGroup({ title, tools, onOpen }: ToolGroupProps) {
  const desktop = useIsDesktop();
  if (tools.length === 0) return null;

  if (desktop) {
    return (
      <View style={styles.desktopGroup}>
        <SectionHeader title={title} />
        <TileGrid
          items={tools}
          columns={3}
          gap={Spacing.md}
          keyExtractor={(tool) => tool.id}
          renderItem={(tool) => <ToolCard tool={tool} onPress={() => onOpen(tool)} />}
        />
      </View>
    );
  }

  return (
    <View>
      <SectionHeader title={title} />
      <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
        {tools.map((tool) => (
          <ToolRow key={tool.id} tool={tool} onPress={() => onOpen(tool)} />
        ))}
      </Card>
    </View>
  );
}

function ToolCard({ tool, onPress }: { tool: ToolDef; onPress: () => void }) {
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
      accessibilityRole="button"
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.toolCard,
        {
          backgroundColor: pressed ? theme.backgroundElement : theme.card,
          borderColor: pressed ? theme.borderStrong : theme.border,
        },
      ]}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, { backgroundColor: withAlpha(color, 0.16) }]}>
          <Icon name={tool.icon} size={25} color={color} />
        </View>
        {tool.status !== 'ready' ? (
          <Badge label={STATUS_LABEL[tool.status]} color={statusColor[tool.status]} variant="soft" small />
        ) : null}
        {tool.premium ? <Badge label="Premium" color={Accents.amber} variant="soft" small /> : null}
      </View>
      <View style={styles.cardBody}>
        <Txt variant="h3" numberOfLines={1}>
          {tool.title}
        </Txt>
        {tool.subtitle ? (
          <Txt variant="caption" muted numberOfLines={2}>
            {tool.subtitle}
          </Txt>
        ) : null}
      </View>
      <View style={styles.cardFooter}>
        <Txt variant="tiny" muted>
          {tool.input.toUpperCase()}
        </Txt>
        <Icon name="arrow-right" size={18} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  desktopGroup: { marginTop: Spacing.xs },
  toolCard: {
    minHeight: 168,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.sm },
  cardIcon: {
    width: 50,
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { gap: Spacing.xs },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
