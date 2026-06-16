import { Pressable, StyleSheet, View } from 'react-native';

import { AppHeader, Badge, Icon, Screen, TileGrid, Txt } from '@/components/ui';
import { pickTools } from '@/constants/tools';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useOpenTool } from '@/hooks/use-open-tool';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import * as haptics from '@/lib/haptics';
import type { ToolDef } from '@/types';

const EDITOR_TOOLS = pickTools([
  'add-page-numbers',
  'add-watermark',
  'flatten',
  'crop-pdf',
  'add-text',
  'add-signature',
  'doodle',
  'highlight',
  'add-stamp',
  'annotate',
  'redact',
  'fill-forms',
]);

function editorRoute(tool: ToolDef) {
  return `/pdf-editor?tool=${encodeURIComponent(tool.id)}` as const;
}

export default function EditScreen() {
  const openTool = useOpenTool();
  const desktop = useIsDesktop();
  const crop = EDITOR_TOOLS.find((tool) => tool.id === 'crop-pdf');
  const rest = EDITOR_TOOLS.filter((tool) => tool.id !== 'crop-pdf');

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: desktop ? 48 : 120 }}>
      <AppHeader title={desktop ? 'PDF editing studio' : 'Edit PDF'} />
      <Txt variant="caption" muted style={styles.subtitle}>
        Open a PDF into a full editor with thumbnails, canvas preview, tool settings, undo, zoom, and export controls.
      </Txt>

      {crop ? <FeaturedCropCard tool={crop} onPress={() => openTool(crop, editorRoute(crop))} /> : null}

      <View style={styles.group}>
        <View style={styles.groupHeader}>
          <Txt variant="h3">Edit PDF tools</Txt>
          <Badge label="Frontend studio" color={Accents.teal} variant="soft" small />
        </View>
        <TileGrid
          items={rest}
          columns={desktop ? 3 : 1}
          gap={Spacing.md}
          keyExtractor={(tool) => tool.id}
          renderItem={(tool) => <PremiumToolCard tool={tool} onPress={() => openTool(tool, editorRoute(tool))} />}
        />
      </View>
    </Screen>
  );
}

function FeaturedCropCard({ tool, onPress }: { tool: ToolDef; onPress: () => void }) {
  const theme = useTheme();
  const color = Accents[tool.accent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tool.title}. ${tool.subtitle}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.featured,
        {
          backgroundColor: pressed ? theme.backgroundElement : theme.card,
          borderColor: pressed ? color : withAlpha(color, 0.6),
          transform: [{ scale: pressed ? 0.992 : 1 }],
        },
      ]}>
      <View style={[styles.featureIcon, { backgroundColor: withAlpha(color, 0.18) }]}>
        <Icon name={tool.icon} size={34} color={color} />
      </View>
      <View style={styles.featureBody}>
        <View style={styles.featureTitleRow}>
          <Txt variant="title">{tool.title}</Txt>
          <Badge label={tool.premium ? 'Premium crop editor' : 'Crop editor'} color={color} variant="soft" small />
        </View>
        <Txt variant="caption" muted>
          Bright crop overlay, draggable corners and sides, perspective mode, grid guides, page thumbnails, zoom, and apply scopes.
        </Txt>
      </View>
      <View style={[styles.launchCircle, { borderColor: withAlpha(color, 0.55) }]}>
        <Icon name="arrow-right" size={22} color={color} />
      </View>
    </Pressable>
  );
}

function PremiumToolCard({ tool, onPress }: { tool: ToolDef; onPress: () => void }) {
  const theme = useTheme();
  const color = Accents[tool.accent];
  const needsBadge = tool.id === 'fill-forms' || tool.id === 'redact';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${tool.title}. ${tool.subtitle}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? theme.backgroundElement : theme.card,
          borderColor: pressed ? color : theme.border,
          transform: [{ translateY: pressed ? 1 : 0 }, { scale: pressed ? 0.992 : 1 }],
        },
      ]}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIcon, { backgroundColor: withAlpha(color, 0.16) }]}>
          <Icon name={tool.icon} size={26} color={color} />
        </View>
        {tool.premium ? <Badge label="Premium" color={Accents.amber} variant="soft" small /> : needsBadge ? <Badge label="Advanced UI" color={color} variant="soft" small /> : null}
      </View>
      <View style={styles.cardBody}>
        <Txt variant="h3" numberOfLines={1}>
          {tool.title}
        </Txt>
        <Txt variant="caption" muted numberOfLines={2}>
          {tool.subtitle}
        </Txt>
      </View>
      <View style={styles.cardFooter}>
        <Txt variant="tiny" muted>
          PDF
        </Txt>
        <Icon name="arrow-right" size={18} color={theme.textMuted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginTop: -6, marginBottom: Spacing.lg, maxWidth: 760 },
  group: { gap: Spacing.md },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  featured: {
    minHeight: 170,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    marginBottom: Spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  featureIcon: { width: 76, height: 76, borderRadius: Radius.xl, alignItems: 'center', justifyContent: 'center' },
  featureBody: { flex: 1, gap: Spacing.xs, minWidth: 0 },
  featureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  launchCircle: { width: 48, height: 48, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    minHeight: 172,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  cardIcon: { width: 52, height: 52, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  cardBody: { gap: Spacing.xs },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
