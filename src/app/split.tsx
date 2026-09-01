import { useState } from 'react';
import { View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  Screen,
  Segmented,
  type SegmentedOption,
  TextField,
  Txt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { baseName } from '@/lib/format';
import { getPageCount, splitPdf } from '@/lib/pdf';
import { groupEachPage, groupEveryPages, parsePageRanges } from '@/lib/split-model';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

type Mode = 'ranges' | 'every' | 'each';

const MODE_OPTIONS: SegmentedOption<Mode>[] = [
  { label: 'Ranges', value: 'ranges' },
  { label: 'Every N', value: 'every' },
  { label: 'Each page', value: 'each' },
];

export default function SplitScreen() {
  const runner = useRunner();
  const [file, setFile] = useState<FileItem | null>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('ranges');
  const [ranges, setRanges] = useState('1-1');
  const [perFile, setPerFile] = useState('1');

  const onPicked = async (f: FileItem) => {
    setFile(f);
    setPageCount(null);
    try {
      const bytes = await storage.readBytes(f.storageKey);
      setPageCount(await getPageCount(bytes));
    } catch {
      setPageCount(0);
    }
  };

  const run = () =>
    runner.run(async (onProgress) => {
      if (!file || !pageCount) throw new Error('Could not read the PDF.');
      const bytes = await storage.readBytes(file.storageKey);
      let groups: number[][];
      if (mode === 'each') groups = groupEachPage(pageCount);
      else if (mode === 'every') groups = groupEveryPages(perFile, pageCount);
      else groups = parsePageRanges(ranges, pageCount);

      if (groups.length === 0) throw new Error('Nothing to split.');
      onProgress(0.2);
      const parts = await splitPdf(bytes, groups);
      const base = baseName(file.name);
      const saved: FileItem[] = [];
      for (let i = 0; i < parts.length; i++) {
        saved.push(
          await useLibrary.getState().saveResult({
            bytes: parts[i],
            name: `${base} (${i + 1}).pdf`,
            kind: 'pdf',
            ext: 'pdf',
            mime: 'application/pdf',
            source: 'created',
            pageCount: groups[i].length,
          }),
        );
        onProgress(0.2 + ((i + 1) / parts.length) * 0.8);
      }
      return saved;
    });

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Split PDF" showBack />

      {!file ? (
        <PickFile onPicked={onPicked} title="Select a PDF to split" />
      ) : runner.state !== 'done' ? (
        <>
          <Card style={{ gap: Spacing.xs, marginBottom: Spacing.md }}>
            <Txt variant="body" weight="600" numberOfLines={1}>
              {file.name}
            </Txt>
            <Txt variant="caption" muted>
              {pageCount === null ? 'Reading…' : `${pageCount} pages`}
            </Txt>
          </Card>

          <View style={{ gap: Spacing.md }}>
            <Segmented options={MODE_OPTIONS} value={mode} onChange={setMode} />
            {mode === 'ranges' ? (
              <TextField
                label="Page ranges"
                value={ranges}
                onChangeText={setRanges}
                placeholder="1-3, 5, 8-10"
                hint="Each comma-separated range becomes its own PDF."
                autoCapitalize="none"
              />
            ) : null}
            {mode === 'every' ? (
              <TextField
                label="Pages per file"
                value={perFile}
                onChangeText={setPerFile}
                keyboardType="number-pad"
                hint="Splits sequentially into files of this many pages."
              />
            ) : null}
            {mode === 'each' ? (
              <Txt variant="caption" muted>
                Every page becomes a separate one-page PDF.
              </Txt>
            ) : null}

            <Button
              title="Split PDF"
              icon="call-split"
              onPress={run}
              loading={runner.state === 'running'}
              disabled={!pageCount}
              full
              size="lg"
            />
          </View>
        </>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Splitting…" doneLabel="Split complete" />
    </Screen>
  );
}
