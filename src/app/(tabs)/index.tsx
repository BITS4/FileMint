import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { FileActionsSheet } from '@/components/files/FileActionsSheet';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  FeatureTile,
  FileRow,
  FilterChips,
  type FilterChipItem,
  Icon,
  IconButton,
  Screen,
  SectionHeader,
  TileGrid,
  Txt,
} from '@/components/ui';
import { QUICK_TOOLS } from '@/constants/tools';
import { type AccentName, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { withAlpha } from '@/lib/color';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import { canShareFiles, shareFile } from '@/lib/share';
import { useShallow } from 'zustand/react/shallow';

import { selectActiveFiles, useLibrary } from '@/store/useLibrary';
import type { FileFilter, FileItem } from '@/types';

const FILTERS: FilterChipItem<FileFilter>[] = [
  { key: 'all', label: 'All' },
  { key: 'pdf', label: 'PDF' },
  { key: 'docs', label: 'Docs' },
  { key: 'excel', label: 'Excel' },
  { key: 'ppt', label: 'PPT' },
  { key: 'images', label: 'Images' },
  { key: 'recent', label: 'Recent' },
  { key: 'favorites', label: 'Favorites' },
];

function matchesFilter(file: FileItem, filter: FileFilter): boolean {
  switch (filter) {
    case 'pdf':
      return file.kind === 'pdf';
    case 'docs':
      return file.kind === 'word';
    case 'excel':
      return file.kind === 'excel';
    case 'ppt':
      return file.kind === 'ppt';
    case 'images':
      return file.kind === 'image';
    case 'favorites':
      return file.favorite;
    default:
      return true;
  }
}

interface QuickItem {
  id: string;
  title: string;
  icon: string;
  accent: AccentName;
  route: string;
}

const QUICK_GRID: QuickItem[] = [
  ...QUICK_TOOLS.map((t) => ({ id: t.id, title: t.title, icon: t.icon, accent: t.accent, route: t.route })),
  { id: 'more', title: 'More', icon: 'dots-horizontal-circle-outline', accent: 'slate', route: '/tools' },
];

export default function HomeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const files = useLibrary(useShallow(selectActiveFiles));
  const desktop = useIsDesktop();
  const [filter, setFilter] = useState<FileFilter>('all');
  const [actionFile, setActionFile] = useState<FileItem | null>(null);
  const shareSupported = canShareFiles();

  const recent = useMemo(
    () =>
      files
        .filter((f) => matchesFilter(f, filter))
        .sort((a, b) => b.modifiedAt - a.modifiedAt)
        .slice(0, 6),
    [files, filter],
  );
  const stats = useMemo(
    () => [
      { label: 'Files', value: files.length },
      { label: 'PDFs', value: files.filter((f) => f.kind === 'pdf').length },
      { label: 'Favorites', value: files.filter((f) => f.favorite).length },
    ],
    [files],
  );

  const handleImport = async () => {
    const picked = await pickDocuments({ multiple: true });
    for (const file of picked) await importIntoLibrary(file);
  };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: desktop ? 42 : 110 }}>
      <AppHeader
        title={desktop ? 'Workspace' : 'FileMint'}
        large={!desktop}
        right={
          <>
            <IconButton name="magnify" onPress={() => router.push('/search')} accessibilityLabel="Search" />
            <IconButton name="cog-outline" onPress={() => router.push('/settings')} accessibilityLabel="Settings" />
          </>
        }
      />

      {desktop ? (
        <View style={styles.desktopOverview}>
          <Card style={styles.overviewMain}>
            <Txt variant="title">Document workspace</Txt>
            <Txt variant="caption" muted style={styles.overviewCopy}>
              Convert, organize and review files from one focused desk.
            </Txt>
            <View style={styles.overviewActions}>
              <Button title="Import files" icon="file-import-outline" onPress={handleImport} />
              <Button title="Scan" icon="line-scan" variant="secondary" onPress={() => router.push('/scan')} />
            </View>
          </Card>
          <View style={styles.statsGrid}>
            {stats.map((item) => (
              <Card key={item.label} style={styles.statCard}>
                <Txt variant="display">{item.value}</Txt>
                <Txt variant="caption" muted>
                  {item.label}
                </Txt>
              </Card>
            ))}
          </View>
        </View>
      ) : (
        <Card style={[styles.mobileHero, { borderColor: withAlpha(theme.primary, 0.3) }]}>
          <View style={styles.mobileHeroTop}>
            <View style={[styles.mobileHeroBadge, { backgroundColor: theme.primaryMuted }]}>
              <Icon name="file-star-outline" size={24} color={theme.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="h2" numberOfLines={1}>
                FileMint
              </Txt>
              <Txt variant="caption" muted numberOfLines={2}>
                Convert, scan and edit documents from your phone.
              </Txt>
            </View>
          </View>
          <View style={styles.mobileHeroActions}>
            <Button title="Import" icon="file-import-outline" size="sm" onPress={handleImport} style={{ flex: 1 }} />
            <Button title="Scan" icon="line-scan" size="sm" variant="secondary" onPress={() => router.push('/scan')} style={{ flex: 1 }} />
          </View>
          <View style={styles.mobileStats}>
            {stats.map((item) => (
              <View key={item.label} style={[styles.mobileStat, { backgroundColor: theme.backgroundElement }]}>
                <Txt variant="h3">{item.value}</Txt>
                <Txt variant="tiny" muted>
                  {item.label}
                </Txt>
              </View>
            ))}
          </View>
        </Card>
      )}

      <TileGrid
        items={QUICK_GRID as unknown as (typeof QUICK_GRID)[number][]}
        columns={desktop ? 6 : 2}
        gap={Spacing.md}
        keyExtractor={(item) => item.id}
        renderItem={(item) => (
          <FeatureTile
            title={item.title}
            icon={item.icon}
            accent={item.accent}
            onPress={() => router.push(item.route)}
          />
        )}
      />

      <View style={{ marginTop: Spacing.lg }}>
        <FilterChips items={FILTERS} value={filter} onChange={setFilter} />
      </View>

      <SectionHeader
        title="Recent files"
        actionLabel={files.length ? 'See all' : undefined}
        onAction={files.length ? () => router.push('/files') : undefined}
      />

      {recent.length === 0 ? (
        <EmptyState
          icon="file-document-plus-outline"
          title={files.length ? 'Nothing here' : 'No files yet'}
          subtitle={
            files.length
              ? 'No files match this filter.'
              : 'Import a document, snap a scan or turn images into a PDF to get started.'
          }
          actionLabel={files.length ? undefined : 'Import a file'}
          onAction={files.length ? undefined : handleImport}
        />
      ) : (
        <View style={desktop ? styles.recentPanel : undefined}>
          {recent.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onPress={() => router.push(`/viewer/${file.id}`)}
              onShare={shareSupported ? () => void shareFile(file) : undefined}
              onMore={() => setActionFile(file)}
            />
          ))}
        </View>
      )}

      <FileActionsSheet file={actionFile} onClose={() => setActionFile(null)} />
    </Screen>
  );
}

const styles = {
  desktopOverview: {
    flexDirection: 'row' as const,
    gap: Spacing.md,
    marginBottom: Spacing.xl,
  },
  overviewMain: {
    flex: 1.5,
    minHeight: 174,
    justifyContent: 'space-between' as const,
  },
  overviewCopy: { marginTop: Spacing.xs, maxWidth: 480 },
  overviewActions: { flexDirection: 'row' as const, gap: Spacing.md, marginTop: Spacing.xl, flexWrap: 'wrap' as const },
  statsGrid: { flex: 1, flexDirection: 'row' as const, gap: Spacing.md },
  statCard: { flex: 1, minHeight: 174, justifyContent: 'center' as const },
  recentPanel: {
    borderRadius: 18,
    overflow: 'hidden' as const,
  },
  mobileHero: {
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  mobileHeroTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.md,
  },
  mobileHeroBadge: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  mobileHeroActions: { flexDirection: 'row' as const, gap: Spacing.sm },
  mobileStats: { flexDirection: 'row' as const, gap: Spacing.sm },
  mobileStat: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: Spacing.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};
