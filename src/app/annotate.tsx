import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  Icon,
  Screen,
  Segmented,
  type SegmentedOption,
  TextField,
  Txt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { baseName } from '@/lib/format';
import { type StampPosition, addTextToPage, getPageCount, markAreaOnPage } from '@/lib/pdf';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

const POSITIONS: SegmentedOption<StampPosition>[] = [
  { label: 'Top', value: 'top-center' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'bottom-center' },
];
const COLORS: Record<string, { r: number; g: number; b: number }> = {
  black: { r: 0.1, g: 0.1, b: 0.1 },
  red: { r: 0.86, g: 0.15, b: 0.15 },
  blue: { r: 0.15, g: 0.35, b: 0.85 },
};
const COLOR_OPTIONS: SegmentedOption<string>[] = [
  { label: 'Black', value: 'black' },
  { label: 'Red', value: 'red' },
  { label: 'Blue', value: 'blue' },
];

const TOOL_DEFAULT: Record<string, { text: string; bold: boolean; color: string }> = {
  text: { text: '', bold: false, color: 'black' },
  stamp: { text: 'APPROVED', bold: true, color: 'red' },
  sign: { text: 'Signed by', bold: false, color: 'blue' },
  highlight: { text: '', bold: false, color: 'yellow' },
  redact: { text: '', bold: false, color: 'black' },
};
const MARK_COLORS: Record<string, { r: number; g: number; b: number }> = {
  yellow: { r: 1, g: 0.86, b: 0.2 },
  black: { r: 0, g: 0, b: 0 },
};

export default function AnnotateScreen() {
  const { tool } = useLocalSearchParams<{ tool?: string }>();
  const theme = useTheme();
  const runner = useRunner();
  const preset = (tool && TOOL_DEFAULT[tool]) || { text: '', bold: false, color: 'black' };
  const mode = tool === 'highlight' || tool === 'redact' ? tool : 'text';

  const [file, setFile] = useState<FileItem | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [text, setText] = useState(preset.text);
  const [page, setPage] = useState('1');
  const [position, setPosition] = useState<StampPosition>('center');
  const [color, setColor] = useState(preset.color);
  const [size, setSize] = useState('28');

  const onPicked = async (f: FileItem) => {
    setFile(f);
    try {
      const bytes = await storage.readBytes(f.storageKey);
      setPageCount(Math.max(1, await getPageCount(bytes)));
    } catch {
      setPageCount(1);
    }
  };

  const run = () =>
    runner.run(async (onProgress) => {
      if (!file) throw new Error('No file selected.');
      const bytes = await storage.readBytes(file.storageKey);
      onProgress(0.4);
      const pageIndex = (parseInt(page, 10) || 1) - 1;
      const out =
        mode === 'highlight'
          ? await markAreaOnPage(bytes, {
              pageIndex,
              position,
              color: MARK_COLORS.yellow,
              opacity: 0.42,
              height: 30,
            })
          : mode === 'redact'
            ? await markAreaOnPage(bytes, {
                pageIndex,
                position,
                color: MARK_COLORS.black,
                opacity: 1,
                height: 38,
              })
            : await addTextToPage(bytes, {
                pageIndex,
                text: text.trim() || preset.text || 'Text',
                position,
                fontSize: parseFloat(size) || 28,
                color: COLORS[color] ?? COLORS.black,
                bold: preset.bold,
              });
      return useLibrary.getState().saveResult({
        bytes: out,
        name: `${baseName(file.name)} annotated.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
      });
    });

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Annotate" showBack />

      <View style={[banner(theme)]}>
        <Icon name="information-outline" size={16} color={theme.warning} />
        <Txt variant="caption" style={{ color: theme.warning, flex: 1 }}>
          Beta - text, stamps, signatures, highlights and redaction blocks are supported.
        </Txt>
      </View>

      {!file ? (
        <PickFile
          onPicked={onPicked}
          title="Select a PDF"
          subtitle="Add a text note or stamp to a page."
          icon="comment-edit-outline"
        />
      ) : runner.state !== 'done' ? (
        <View style={{ gap: Spacing.md }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon name="file-check-outline" size={20} color={theme.primary} />
            <Txt variant="body" weight="600" numberOfLines={1} style={{ flex: 1 }}>
              {file.name}
            </Txt>
            <Txt variant="caption" muted>
              {pageCount} pages
            </Txt>
          </Card>

          {mode === 'text' ? (
            <TextField
              label="Text"
              value={text}
              onChangeText={setText}
              placeholder="Type the text to place"
            />
          ) : null}
          <TextField
            label={`Page (1–${pageCount})`}
            value={page}
            onChangeText={setPage}
            keyboardType="number-pad"
          />
          <Labeled label="Position">
            <Segmented options={POSITIONS} value={position} onChange={setPosition} />
          </Labeled>
          {mode === 'text' ? (
            <>
              <Labeled label="Color">
                <Segmented options={COLOR_OPTIONS} value={color} onChange={setColor} />
              </Labeled>
              <TextField label="Font size" value={size} onChangeText={setSize} keyboardType="number-pad" />
            </>
          ) : null}

          <Button
            title="Add to PDF"
            icon="format-text"
            onPress={run}
            loading={runner.state === 'running'}
            full
            size="lg"
          />
        </View>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Applying…" doneLabel="Annotation added" />
    </Screen>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.xs }}>
      <Txt variant="label" muted style={{ marginLeft: 2 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function banner(theme: { warningMuted: string }) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 14,
    marginBottom: Spacing.md,
    backgroundColor: theme.warningMuted,
  };
}
