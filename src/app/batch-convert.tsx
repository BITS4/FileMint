import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { ToolOutcome } from '@/components/tools/ToolOutcome';
import { AppHeader, Button, Card, Chip, EmptyState, Icon, Screen, Txt } from '@/components/ui';
import { Accents, Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { type ServerStatus, checkServer, convertFile } from '@/lib/api';
import { withAlpha } from '@/lib/color';
import { baseName, formatBytes, kindMeta, withExt } from '@/lib/format';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import * as storage from '@/lib/storage';
import { useLibrary, selectActiveFiles } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import type { FileItem } from '@/types';

type BatchTarget = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'html';

const TARGETS: { value: BatchTarget; label: string; icon: string }[] = [
  { value: 'pdf', label: 'PDF', icon: 'file-pdf-box' },
  { value: 'docx', label: 'Word', icon: 'file-word-box' },
  { value: 'xlsx', label: 'Excel', icon: 'file-excel-box' },
  { value: 'pptx', label: 'PowerPoint', icon: 'file-powerpoint-box' },
  { value: 'html', label: 'HTML', icon: 'language-html5' },
];

function capabilityFor(target: BatchTarget) {
  if (target === 'pdf') return 'libreoffice' as const;
  if (target === 'docx') return 'pdf2docx' as const;
  return 'pdfExport' as const;
}

function canConvert(file: FileItem, target: BatchTarget): boolean {
  if (target === 'pdf') return file.kind === 'word' || file.kind === 'excel' || file.kind === 'ppt';
  return file.kind === 'pdf';
}

function fieldsFor(target: BatchTarget): Record<string, string | boolean> {
  if (target === 'docx') {
    return {
      target,
      mode: 'premium',
      language: useSettings.getState().ocrLanguage || 'auto',
      tableDetection: true,
      preserveLayout: true,
    };
  }
  if (target === 'xlsx') {
    return { target, language: useSettings.getState().ocrLanguage || 'auto', tableDetection: true };
  }
  if (target === 'pptx' || target === 'html') {
    return { target, language: useSettings.getState().ocrLanguage || 'auto', textLayer: true };
  }
  return { target };
}

async function convertOne(file: FileItem, target: BatchTarget): Promise<FileItem> {
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'convert',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: fieldsFor(target),
  });
  const fallback = `${baseName(file.name)}.${target}`;
  return useLibrary.getState().saveResult({
    bytes: res.bytes,
    name: withExt(res.filename && res.filename !== 'result' ? res.filename : fallback, target),
    ext: target,
    mime: res.mime,
    source: 'convert',
    conversionReport: res.report,
  });
}

export default function BatchConvertScreen() {
  const theme = useTheme();
  const runner = useRunner();
  const libraryFiles = useLibrary(useShallow(selectActiveFiles));
  const [target, setTarget] = useState<BatchTarget>('pdf');
  const [selected, setSelected] = useState<string[]>([]);
  const [server, setServer] = useState<ServerStatus | null>(null);
  const capability = capabilityFor(target);

  const selectedFiles = useMemo(
    () => selected.map((id) => libraryFiles.find((f) => f.id === id)).filter(Boolean) as FileItem[],
    [libraryFiles, selected],
  );
  const convertibleFiles = selectedFiles.filter((file) => canConvert(file, target));
  const availableFiles = libraryFiles.filter((file) => canConvert(file, target));
  const skipped = selectedFiles.length - convertibleFiles.length;
  const serverMissing = server !== null && (!server.online || !server.capabilities[capability]);

  const refreshServer = () => {
    setServer(null);
    checkServer().then(setServer);
  };

  useEffect(() => {
    refreshServer();
    setSelected((prev) =>
      prev.filter((id) => {
        const file = libraryFiles.find((f) => f.id === id);
        return file ? canConvert(file, target) : false;
      }),
    );
  }, [target]);

  const importFiles = async () => {
    const picked = await pickDocuments({ multiple: true, type: '*/*' });
    const imported: FileItem[] = [];
    for (const item of picked) imported.push(await importIntoLibrary(item));
    const ids = imported.filter((file) => canConvert(file, target)).map((file) => file.id);
    setSelected((prev) => Array.from(new Set([...ids, ...prev])));
  };

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev]));

  const run = () =>
    runner.run(async (onProgress) => {
      if (!convertibleFiles.length) throw new Error('Select at least one compatible file.');
      const results: FileItem[] = [];
      for (let i = 0; i < convertibleFiles.length; i++) {
        onProgress(i / convertibleFiles.length);
        results.push(await convertOne(convertibleFiles[i], target));
      }
      onProgress(1);
      return results;
    });

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Batch Convert" showBack />
      <Txt variant="caption" muted style={{ marginTop: -6, marginBottom: Spacing.md }}>
        Convert many compatible files with the same premium server engines.
      </Txt>

      <View style={styles.targetGrid}>
        {TARGETS.map((option) => {
          const active = option.value === target;
          return (
            <Pressable
              key={option.value}
              onPress={() => setTarget(option.value)}
              style={[
                styles.target,
                {
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active ? withAlpha(theme.primary, 0.14) : theme.backgroundElement,
                },
              ]}
            >
              <Icon name={option.icon} size={20} color={active ? theme.primary : theme.textSecondary} />
              <Txt variant="label" weight="700" style={{ color: active ? theme.primary : theme.text }}>
                {option.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {server === null ? (
        <Card style={styles.inlineCard}>
          <ActivityIndicator color={theme.primary} />
          <Txt variant="caption" muted>
            Waking conversion server. This can take a few seconds after inactivity...
          </Txt>
        </Card>
      ) : null}

      {serverMissing ? (
        <Card style={{ borderColor: theme.warning, gap: Spacing.sm }}>
          <View style={styles.row}>
            <Icon name="server-network-off" size={20} color={theme.warning} />
            <Txt variant="h3">Server needed</Txt>
          </View>
          <Txt variant="caption" muted>
            {server?.online
              ? `The server is online, but the ${capability} engine is not available.`
              : 'The hosted FileMint conversion server may be waking up. Tap Check again and wait a few seconds.'}
          </Txt>
          <Button title="Check again" icon="refresh" onPress={refreshServer} full />
        </Card>
      ) : null}

      {runner.state === 'idle' || runner.state === 'error' ? (
        <View style={{ gap: Spacing.md }}>
          <Card style={{ gap: Spacing.sm }}>
            <View style={styles.rowBetween}>
              <Txt variant="h3">Files</Txt>
              <Chip label={`${convertibleFiles.length} selected`} active />
            </View>
            <View style={styles.actions}>
              <Button title="Import files" icon="upload" onPress={importFiles} style={{ flex: 1 }} />
              <Button
                title="Select all"
                icon="checkbox-multiple-marked-outline"
                variant="secondary"
                onPress={() => setSelected(availableFiles.map((file) => file.id))}
                disabled={!availableFiles.length}
                style={{ flex: 1 }}
              />
            </View>
            {skipped > 0 ? (
              <Txt variant="tiny" muted>
                {skipped} selected file{skipped === 1 ? '' : 's'} cannot convert to {target.toUpperCase()} and
                will be skipped.
              </Txt>
            ) : null}
          </Card>

          {availableFiles.length ? (
            <View style={{ gap: Spacing.sm }}>
              {availableFiles.slice(0, 80).map((file) => (
                <BatchFileRow
                  key={file.id}
                  file={file}
                  selected={selected.includes(file.id)}
                  onPress={() => toggle(file.id)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="file-search-outline"
              title="No compatible files"
              subtitle={
                target === 'pdf' ? 'Import Word, Excel or PowerPoint files first.' : 'Import PDF files first.'
              }
              compact
            />
          )}

          <Button
            title={`Convert ${convertibleFiles.length || ''}`.trim()}
            icon="layers-triple-outline"
            size="lg"
            onPress={run}
            disabled={!convertibleFiles.length || !!serverMissing || server === null}
            full
          />
        </View>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Batch converting..." doneLabel="Batch complete" />
    </Screen>
  );
}

function BatchFileRow({
  file,
  selected,
  onPress,
}: {
  file: FileItem;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const meta = kindMeta(file.kind);
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.fileRow,
        {
          borderColor: selected ? theme.primary : theme.border,
          backgroundColor: selected ? withAlpha(theme.primary, 0.12) : theme.backgroundElement,
        },
      ]}
    >
      <View style={[styles.fileIcon, { backgroundColor: withAlpha(Accents[meta.accent], 0.15) }]}>
        <Icon name={meta.icon} size={20} color={Accents[meta.accent]} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="label" numberOfLines={1}>
          {file.name}
        </Txt>
        <Txt variant="tiny" muted>
          {meta.label} · {formatBytes(file.size)}
        </Txt>
      </View>
      <Icon
        name={selected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
        size={24}
        color={selected ? theme.primary : theme.textSecondary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  targetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  target: {
    minWidth: 104,
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  inlineCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  fileRow: {
    borderWidth: 1,
    borderRadius: 8,
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  fileIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
