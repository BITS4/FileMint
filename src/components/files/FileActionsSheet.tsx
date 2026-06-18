import { useRouter } from 'expo-router';
import { useState } from 'react';

import { ActionSheet, PromptModal, type SheetAction } from '@/components/ui';
import { baseName, withExt } from '@/lib/format';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

export interface FileActionsSheetProps {
  file: FileItem | null;
  onClose: () => void;
  variant?: 'active' | 'trash';
}

export function FileActionsSheet({ file, onClose, variant = 'active' }: FileActionsSheetProps) {
  const router = useRouter();
  const lib = useLibrary();
  const [renameTarget, setRenameTarget] = useState<FileItem | null>(null);
  const shareSupported = canShareFiles();

  const buildActions = (f: FileItem): SheetAction[] => {
    if (variant === 'trash') {
      return [
        { label: 'Restore', icon: 'restore', onPress: () => lib.restoreFile(f.id) },
        {
          label: 'Delete forever',
          icon: 'delete-forever-outline',
          destructive: true,
          onPress: () => void lib.deleteForever(f.id),
        },
      ];
    }
    const editable = ['pdf', 'text', 'csv', 'word', 'excel', 'ppt'].includes(f.kind);
    const editRoute = f.kind === 'pdf' ? `/pdf-editor?file=${encodeURIComponent(f.id)}&tool=annotate` : `/edit/${f.id}`;
    return [
      { label: 'Open', icon: 'eye-outline', onPress: () => router.push(`/viewer/${f.id}`) },
      ...(editable
        ? [{ label: 'Edit', icon: 'pencil-outline', onPress: () => router.push(editRoute as never) } as SheetAction]
        : []),
      { label: 'Share', icon: 'share-variant', disabled: !shareSupported, onPress: () => void shareFile(f) },
      { label: 'Download', icon: 'download-outline', onPress: () => void downloadFile(f) },
      { label: 'Rename', icon: 'rename-box', onPress: () => setRenameTarget(f) },
      {
        label: f.favorite ? 'Remove favorite' : 'Add to favorites',
        icon: f.favorite ? 'star-off' : 'star-outline',
        onPress: () => lib.toggleFavorite(f.id),
      },
      { label: 'Duplicate', icon: 'content-copy', onPress: () => void lib.duplicateFile(f.id) },
      { label: 'Move to Trash', icon: 'trash-can-outline', destructive: true, onPress: () => lib.trashFile(f.id) },
    ];
  };

  return (
    <>
      <ActionSheet
        visible={!!file}
        onClose={onClose}
        title={file?.name}
        actions={file ? buildActions(file) : []}
      />
      <PromptModal
        visible={!!renameTarget}
        title="Rename file"
        submitLabel="Rename"
        placeholder="File name"
        initialValue={renameTarget ? baseName(renameTarget.name) : ''}
        onSubmit={(value) => {
          const name = value.trim();
          if (renameTarget && name) lib.renameFile(renameTarget.id, withExt(name, renameTarget.ext));
          setRenameTarget(null);
        }}
        onClose={() => setRenameTarget(null)}
      />
    </>
  );
}
