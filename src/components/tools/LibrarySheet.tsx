import { Pressable, StyleSheet, View } from 'react-native';

import { EmptyState, Sheet, Thumbnail, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes, formatPages } from '@/lib/format';
import { useShallow } from 'zustand/react/shallow';

import { selectActiveFiles, useLibrary } from '@/store/useLibrary';
import type { FileItem, FileKind } from '@/types';

export interface LibrarySheetProps {
  visible: boolean;
  onClose: () => void;
  kinds?: FileKind[];
  onPick: (file: FileItem) => void;
  title?: string;
  /** Hide ids already chosen (e.g. in merge). */
  excludeIds?: string[];
}

export function LibrarySheet({
  visible,
  onClose,
  kinds,
  onPick,
  title = 'Choose from FileMint',
  excludeIds,
}: LibrarySheetProps) {
  const theme = useTheme();
  const files = useLibrary(useShallow(selectActiveFiles));
  const filtered = files.filter(
    (f) => (!kinds || kinds.includes(f.kind)) && !(excludeIds ?? []).includes(f.id),
  );

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {filtered.length === 0 ? (
        <EmptyState
          icon="folder-open-outline"
          title="No files here"
          subtitle="Import a file first, then pick it here."
          compact
        />
      ) : (
        <View style={{ paddingBottom: Spacing.sm }}>
          {filtered.map((file) => (
            <Pressable
              key={file.id}
              onPress={() => onPick(file)}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? theme.backgroundElement : 'transparent' },
              ]}
            >
              <Thumbnail file={file} size={42} />
              <View style={{ flex: 1 }}>
                <Txt variant="body" weight="600" numberOfLines={1}>
                  {file.name}
                </Txt>
                <Txt variant="tiny" muted>
                  {[formatBytes(file.size), formatPages(file.pageCount)].filter(Boolean).join('  ·  ')}
                </Txt>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Sheet>
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
  },
});
