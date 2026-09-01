import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';

import { Button, IconButton, Txt } from '@/components/ui';
import { styles } from '@/components/pdf-editor/styles';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import type { PreviewPage } from '@/lib/pdf-editor/types';

export function TopToolbar({
  title,
  fileName,
  zoom,
  onBack,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onSave,
  saving,
  canSave,
}: {
  title: string;
  fileName?: string;
  zoom: number;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  if (!desktop) {
    return (
      <View style={[styles.topbarMobile, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <View style={styles.mobileTopMain}>
          <IconButton name="arrow-left" onPress={onBack} accessibilityLabel="Back" />
          <View style={styles.titleBlock}>
            <Txt variant="h3" numberOfLines={1}>
              {title}
            </Txt>
            <Txt variant="tiny" muted numberOfLines={1}>
              {fileName ?? 'No file selected'}
            </Txt>
          </View>
          <IconButton
            name="content-save-outline"
            variant="surface"
            onPress={onSave}
            disabled={saving || !canSave}
            accessibilityLabel="Save or export"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mobileToolbarContent}
        >
          <IconButton name="undo" variant="surface" onPress={onUndo} accessibilityLabel="Undo" />
          <IconButton name="redo" variant="surface" onPress={onRedo} accessibilityLabel="Redo" />
          <IconButton
            name="magnify-minus-outline"
            variant="surface"
            onPress={onZoomOut}
            accessibilityLabel="Zoom out"
          />
          <Pressable
            onPress={onFit}
            style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityRole="button"
          >
            <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
          </Pressable>
          <IconButton
            name="magnify-plus-outline"
            variant="surface"
            onPress={onZoomIn}
            accessibilityLabel="Zoom in"
          />
          <Button
            title="Export"
            icon="export-variant"
            size="sm"
            onPress={onSave}
            loading={saving}
            disabled={!canSave}
          />
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[styles.topbar, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <IconButton name="arrow-left" onPress={onBack} accessibilityLabel="Back" />
      <View style={styles.titleBlock}>
        <Txt variant="h3" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="tiny" muted numberOfLines={1}>
          {fileName ?? 'No file selected'}
        </Txt>
      </View>
      <View style={styles.toolbarGroup}>
        <IconButton name="undo" variant="surface" onPress={onUndo} accessibilityLabel="Undo" />
        <IconButton name="redo" variant="surface" onPress={onRedo} accessibilityLabel="Redo" />
      </View>
      <View style={styles.zoomGroup}>
        <IconButton
          name="magnify-minus-outline"
          variant="surface"
          onPress={onZoomOut}
          accessibilityLabel="Zoom out"
        />
        <Pressable
          onPress={onFit}
          style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
        </Pressable>
        <IconButton
          name="magnify-plus-outline"
          variant="surface"
          onPress={onZoomIn}
          accessibilityLabel="Zoom in"
        />
      </View>
      <Button
        title="Save / Export"
        icon="content-save-outline"
        size="sm"
        onPress={onSave}
        loading={saving}
        disabled={!canSave}
      />
    </View>
  );
}

export function PageSidebar({
  pages,
  pageIndex,
  loading,
  onSelect,
}: {
  pages: PreviewPage[];
  pageIndex: number;
  loading: boolean;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.sidebar, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <Txt variant="label">Pages</Txt>
      <ScrollView contentContainerStyle={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
        {loading && !pages.length
          ? [0, 1, 2, 3].map((i) => <PageSkeleton key={i} />)
          : pages.map((page) => (
              <Pressable
                key={page.index}
                onPress={() => onSelect(page.index)}
                style={[
                  styles.sideThumb,
                  {
                    borderColor: page.index === pageIndex ? theme.primary : theme.border,
                    backgroundColor: page.index === pageIndex ? theme.primaryMuted : theme.backgroundElement,
                  },
                ]}
              >
                <Image source={{ uri: page.uri }} resizeMode="cover" style={styles.sideThumbImage} />
                <Txt variant="tiny">Page {page.index + 1}</Txt>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

export function PageStrip({
  pages,
  pageIndex,
  loading,
  onSelect,
}: {
  pages: PreviewPage[];
  pageIndex: number;
  loading: boolean;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.mobileStrip, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileStripContent}
      >
        {loading && !pages.length
          ? [0, 1, 2].map((i) => <PageSkeleton key={i} compact />)
          : pages.map((page) => (
              <Pressable
                key={page.index}
                onPress={() => onSelect(page.index)}
                style={[
                  styles.stripThumb,
                  {
                    borderColor: page.index === pageIndex ? theme.primary : theme.border,
                    backgroundColor: page.index === pageIndex ? theme.primaryMuted : theme.backgroundElement,
                  },
                ]}
              >
                <Image source={{ uri: page.uri }} resizeMode="cover" style={styles.stripThumbImage} />
                <Txt variant="tiny">{page.index + 1}</Txt>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

function PageSkeleton({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        compact ? styles.stripThumb : styles.sideThumb,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View
        style={[
          compact ? styles.stripThumbImage : styles.sideThumbImage,
          { backgroundColor: theme.skeleton, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <ActivityIndicator color={theme.primary} />
      </View>
    </View>
  );
}
