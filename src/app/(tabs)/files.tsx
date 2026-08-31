import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { FileActionsSheet } from '@/components/files/FileActionsSheet';
import {
  ActionSheet,
  AppHeader,
  Button,
  Card,
  EmptyState,
  FileGridItem,
  FileRow,
  FilterChips,
  type FilterChipItem,
  IconButton,
  Screen,
  type SheetAction,
  TileGrid,
  Txt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import { canShareFiles, shareFile } from '@/lib/share';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem, SortKey, ViewMode } from '@/types';

type Tab = 'all' | 'favorites' | 'trash';

const TABS: FilterChipItem<Tab>[] = [
  { key: 'all', label: 'All files', icon: 'file-multiple-outline' },
  { key: 'favorites', label: 'Favorites', icon: 'star-outline' },
  { key: 'trash', label: 'Trash', icon: 'trash-can-outline' },
];

const SORT_LABEL: Record<SortKey, string> = {
  date: 'Date modified',
  name: 'Name',
  size: 'Size',
  type: 'Type',
};

function sortFiles(arr: FileItem[], key: SortKey): FileItem[] {
  const copy = [...arr];
  switch (key) {
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
    case 'size':
      return copy.sort((a, b) => b.size - a.size);
    case 'type':
      return copy.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
    default:
      return copy.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
}

export default function FilesScreen() {
  const router = useRouter();
  const desktop = useIsDesktop();
  const allFiles = useLibrary((s) => s.files);
  const emptyTrash = useLibrary((s) => s.emptyTrash);
  const [tab, setTab] = useState<Tab>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortKey>('date');
  const [sortOpen, setSortOpen] = useState(false);
  const [actionFile, setActionFile] = useState<FileItem | null>(null);
  const shareSupported = canShareFiles();

  const files = useMemo(() => {
    const base = allFiles.filter((f) => {
      if (tab === 'trash') return f.trashed;
      if (f.trashed) return false;
      if (tab === 'favorites') return f.favorite;
      return true;
    });
    return sortFiles(base, sort);
  }, [allFiles, tab, sort]);

  const sortActions: SheetAction[] = (Object.keys(SORT_LABEL) as SortKey[]).map((key) => ({
    label: SORT_LABEL[key],
    icon: sort === key ? 'check' : 'sort',
    onPress: () => setSort(key),
  }));

  const handleImport = async () => {
    const picked = await pickDocuments({ multiple: true });
    for (const file of picked) await importIntoLibrary(file);
  };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: desktop ? 42 : 110 }}>
      <AppHeader
        title={desktop ? 'Library' : 'Files'}
        right={
          <>
            <IconButton name="magnify" onPress={() => router.push('/search')} accessibilityLabel="Search" />
            <IconButton
              name={view === 'list' ? 'view-grid-outline' : 'format-list-bulleted'}
              onPress={() => setView((v) => (v === 'list' ? 'grid' : 'list'))}
              accessibilityLabel="Toggle view"
            />
            <IconButton name="sort-variant" onPress={() => setSortOpen(true)} accessibilityLabel="Sort" />
          </>
        }
      />

      {desktop ? (
        <Card style={styles.desktopToolbar}>
          <View style={styles.desktopToolbarMain}>
            <FilterChips items={TABS} value={tab} onChange={setTab} />
            <Txt variant="caption" muted>
              {files.length} {files.length === 1 ? 'item' : 'items'} - {SORT_LABEL[sort]}
            </Txt>
          </View>
          <View style={styles.desktopToolbarActions}>
            <Button title="Import" icon="file-import-outline" variant="secondary" onPress={handleImport} />
            <Button title="Sort" icon="sort-variant" variant="ghost" onPress={() => setSortOpen(true)} />
          </View>
        </Card>
      ) : (
        <FilterChips items={TABS} value={tab} onChange={setTab} />
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: Spacing.md,
          marginBottom: Spacing.sm,
        }}
      >
        <Txt variant="caption" muted>
          {files.length} {files.length === 1 ? 'item' : 'items'} · {SORT_LABEL[sort]}
        </Txt>
        {tab === 'trash' && files.length > 0 ? (
          <IconButton
            name="delete-sweep-outline"
            size={20}
            onPress={() => void emptyTrash()}
            accessibilityLabel="Empty trash"
          />
        ) : null}
      </View>

      {files.length === 0 ? (
        <EmptyState
          icon={
            tab === 'trash'
              ? 'trash-can-outline'
              : tab === 'favorites'
                ? 'star-outline'
                : 'folder-open-outline'
          }
          title={
            tab === 'trash' ? 'Trash is empty' : tab === 'favorites' ? 'No favorites yet' : 'No files yet'
          }
          subtitle={
            tab === 'all'
              ? 'Import documents or create new files to see them here.'
              : tab === 'favorites'
                ? 'Mark files as favorite to find them fast.'
                : 'Deleted files will appear here.'
          }
          actionLabel={tab === 'all' ? 'Import a file' : undefined}
          onAction={tab === 'all' ? handleImport : undefined}
        />
      ) : view === 'grid' ? (
        <TileGrid
          items={files}
          columns={desktop ? 5 : 2}
          gap={desktop ? Spacing.md : Spacing.sm}
          keyExtractor={(f) => f.id}
          renderItem={(file) => (
            <FileGridItem
              file={file}
              onPress={() => router.push(`/viewer/${file.id}`)}
              onMore={() => setActionFile(file)}
            />
          )}
        />
      ) : (
        <View style={desktop ? styles.desktopList : undefined}>
          {files.map((file) => (
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

      <ActionSheet
        visible={sortOpen}
        onClose={() => setSortOpen(false)}
        title="Sort by"
        actions={sortActions}
      />
      <FileActionsSheet
        file={actionFile}
        onClose={() => setActionFile(null)}
        variant={tab === 'trash' ? 'trash' : 'active'}
      />
    </Screen>
  );
}

const styles = {
  desktopToolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: Spacing.lg,
    marginBottom: Spacing.md,
  },
  desktopToolbarMain: { flex: 1, gap: Spacing.xs },
  desktopToolbarActions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: Spacing.sm },
  desktopList: {
    borderRadius: 18,
    overflow: 'hidden' as const,
  },
};
