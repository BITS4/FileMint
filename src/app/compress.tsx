import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import { AppHeader, Button, Card, Icon, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { baseName, formatBytes } from '@/lib/format';
import { optimizePdf } from '@/lib/pdf';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

export default function CompressScreen() {
  const theme = useTheme();
  const runner = useRunner();
  const [file, setFile] = useState<FileItem | null>(null);

  const run = () =>
    runner.run(async (onProgress) => {
      if (!file) throw new Error('No file selected.');
      const bytes = await storage.readBytes(file.storageKey);
      onProgress(0.3);
      const optimized = await optimizePdf(bytes);
      onProgress(0.85);
      return useLibrary.getState().saveResult({
        bytes: optimized,
        name: `${baseName(file.name)} compressed.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: file.pageCount,
      });
    });

  const resultFile =
    runner.state === 'done' && runner.result && !Array.isArray(runner.result) ? runner.result : null;
  const saved = file && resultFile ? file.size - resultFile.size : 0;
  const pct = file && saved > 0 ? Math.round((saved / file.size) * 100) : 0;

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Compress PDF" showBack />

      {!file ? (
        <PickFile onPicked={setFile} title="Select a PDF to compress" />
      ) : runner.state !== 'done' ? (
        <>
          <Card style={{ gap: Spacing.xs }}>
            <Txt variant="body" weight="600" numberOfLines={1}>
              {file.name}
            </Txt>
            <Txt variant="caption" muted>
              Current size · {formatBytes(file.size)}
            </Txt>
          </Card>
          <Txt variant="caption" muted style={{ marginTop: Spacing.md }}>
            FileMint optimizes the document structure offline. Image-heavy PDFs compress further with the
            conversion server (Ghostscript) when it&apos;s available.
          </Txt>
          <Button
            title="Compress"
            icon="arrow-collapse-vertical"
            onPress={run}
            loading={runner.state === 'running'}
            full
            size="lg"
            style={{ marginTop: Spacing.lg }}
          />
        </>
      ) : null}

      {resultFile && file ? (
        <Card style={[styles.stats, { borderColor: theme.primary }]}>
          <View style={styles.statCol}>
            <Txt variant="caption" muted>
              Before
            </Txt>
            <Txt variant="h3">{formatBytes(file.size)}</Txt>
          </View>
          <Icon name="arrow-right" size={20} color={theme.textMuted} />
          <View style={styles.statCol}>
            <Txt variant="caption" muted>
              After
            </Txt>
            <Txt variant="h3" style={{ color: theme.primary }}>
              {formatBytes(resultFile.size)}
            </Txt>
          </View>
          <View style={styles.statCol}>
            <Txt variant="caption" muted>
              Saved
            </Txt>
            <Txt variant="h3">{pct > 0 ? `${pct}%` : '—'}</Txt>
          </View>
        </Card>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Compressing…" doneLabel="Compressed" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
  },
  statCol: { alignItems: 'center', gap: 2 },
});
