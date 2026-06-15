import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LibrarySheet } from '@/components/tools/LibrarySheet';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  IconButton,
  Screen,
  SectionHeader,
  TextField,
  Thumbnail,
  Txt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { formatPages, withExt } from '@/lib/format';
import { mergePdfs } from '@/lib/pdf';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

export default function MergeScreen() {
  const theme = useTheme();
  const runner = useRunner();
  const [pdfs, setPdfs] = useState<FileItem[]>([]);
  const [sheet, setSheet] = useState(false);
  const [name, setName] = useState('Merged document');

  const addFromDevice = async () => {
    const picked = await pickDocuments({ multiple: true, type: 'application/pdf' });
    const imported: FileItem[] = [];
    for (const p of picked) imported.push(await importIntoLibrary(p));
    setPdfs((prev) => [...prev, ...imported]);
  };

  const move = (index: number, dir: -1 | 1) =>
    setPdfs((prev) => {
      const arr = [...prev];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr;
    });

  const run = () =>
    runner.run(async (onProgress) => {
      const buffers: Uint8Array[] = [];
      for (let i = 0; i < pdfs.length; i++) {
        buffers.push(await storage.readBytes(pdfs[i].storageKey));
        onProgress(((i + 1) / (pdfs.length + 1)) * 0.7);
      }
      const merged = await mergePdfs(buffers);
      onProgress(0.95);
      return useLibrary.getState().saveResult({
        bytes: merged,
        name: withExt(name || 'Merged document', 'pdf'),
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
      });
    });

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Merge PDF" showBack />

      {runner.state !== 'done' ? (
        <>
          <SectionHeader
            title={pdfs.length ? `${pdfs.length} PDF${pdfs.length === 1 ? '' : 's'}` : 'Add PDFs'}
            actionLabel="From FileMint"
            onAction={() => setSheet(true)}
          />

          {pdfs.length === 0 ? (
            <EmptyState
              icon="call-merge"
              title="Pick at least two PDFs"
              subtitle="Add PDFs from your device or library, reorder them, then merge into one file."
              actionLabel="Import PDFs"
              onAction={addFromDevice}
              compact
            />
          ) : (
            <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
              {pdfs.map((file, index) => (
                <View key={`${file.id}-${index}`} style={styles.row}>
                  <Thumbnail file={file} size={44} />
                  <View style={{ flex: 1 }}>
                    <Txt variant="body" weight="600" numberOfLines={1}>
                      {file.name}
                    </Txt>
                    <Txt variant="tiny" muted>
                      {formatPages(file.pageCount) || 'PDF'}
                    </Txt>
                  </View>
                  <IconButton name="arrow-up" size={20} color={theme.textSecondary} disabled={index === 0} onPress={() => move(index, -1)} />
                  <IconButton name="arrow-down" size={20} color={theme.textSecondary} disabled={index === pdfs.length - 1} onPress={() => move(index, 1)} />
                  <IconButton name="close" size={20} color={theme.danger} onPress={() => setPdfs((p) => p.filter((_, i) => i !== index))} />
                </View>
              ))}
            </Card>
          )}

          {pdfs.length > 0 ? (
            <View style={{ gap: Spacing.md, marginTop: Spacing.md }}>
              <Button title="Add more PDFs" icon="plus" variant="secondary" onPress={addFromDevice} full />
              <TextField label="File name" value={name} onChangeText={setName} />
              <Button
                title="Merge PDFs"
                icon="call-merge"
                onPress={run}
                loading={runner.state === 'running'}
                disabled={pdfs.length < 2}
                full
                size="lg"
              />
              {pdfs.length < 2 ? (
                <Txt variant="tiny" muted center>
                  Add at least two PDFs to merge.
                </Txt>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Merging PDFs…" doneLabel="PDFs merged" />

      <LibrarySheet
        visible={sheet}
        kinds={['pdf']}
        excludeIds={pdfs.map((p) => p.id)}
        onPick={(file) => {
          setSheet(false);
          setPdfs((prev) => [...prev, file]);
        }}
        onClose={() => setSheet(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
});
