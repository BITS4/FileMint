import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { EmptyState, Txt } from '@/components/ui';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import * as storage from '@/lib/storage';
import { decodeUtf8, parseCsvRows } from '@/lib/text';
import type { FileItem } from '@/types';

export interface TextDocumentViewProps {
  file: FileItem;
  night?: boolean;
}

function isHtml(file: FileItem) {
  return file.ext === 'html' || file.ext === 'htm' || file.mime === 'text/html';
}

export function TextDocumentView({ file, night }: TextDocumentViewProps) {
  const theme = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    setText(null);
    setError(undefined);
    storage
      .readBytes(file.storageKey)
      .then((bytes) => {
        if (alive) setText(decodeUtf8(bytes));
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not read this file.');
      });
    return () => {
      alive = false;
    };
  }, [file.storageKey, file.modifiedAt, file.size]);

  const rows = useMemo(() => (file.kind === 'csv' && text ? parseCsvRows(text) : []), [file.kind, text]);
  const pageColor = night ? '#111827' : '#FFFFFF';
  const ink = night ? '#EAF0F6' : '#111827';

  if (error) {
    return (
      <View style={styles.center}>
        <EmptyState icon="file-eye-outline" title="Preview unavailable" subtitle={error} compact />
      </View>
    );
  }

  if (file.kind === 'csv') {
    return (
      <ScrollView style={[styles.root, { backgroundColor: night ? '#0B1117' : '#525659' }]} contentContainerStyle={styles.wrap}>
        <View style={[styles.page, { backgroundColor: pageColor }]}>
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <Txt variant="label" weight="800" style={{ color: ink }} numberOfLines={1}>
              {file.name}
            </Txt>
            <Txt variant="tiny" style={{ color: theme.textSecondary }}>
              {rows.length} rows
            </Txt>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              {rows.map((row, r) => (
                <View key={r} style={styles.tableRow}>
                  {row.map((cell, c) => (
                    <View key={`${r}-${c}`} style={[styles.cell, r === 0 && styles.headCell, { borderColor: theme.border }]}>
                      <Txt variant="tiny" weight={r === 0 ? '800' : '500'} style={{ color: '#111827' }}>
                        {cell}
                      </Txt>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    );
  }

  if (isHtml(file)) {
    return (
      <View style={[styles.root, { backgroundColor: night ? '#0B1117' : '#525659', padding: Spacing.md }]}>
        <View style={styles.webShell}>
          <WebView
            originWhitelist={['*']}
            source={{ html: text ?? '<!doctype html><html><body></body></html>' }}
            javaScriptEnabled={false}
            setSupportMultipleWindows={false}
            style={styles.webView}
          />
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={[styles.root, { backgroundColor: night ? '#0B1117' : '#525659' }]} contentContainerStyle={styles.wrap}>
      <View style={[styles.page, { backgroundColor: pageColor }]}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Txt variant="label" weight="800" style={{ color: ink }} numberOfLines={1}>
            {file.name}
          </Txt>
          <Txt variant="tiny" style={{ color: theme.textSecondary }}>
            {isHtml(file) ? 'HTML source' : file.ext.toUpperCase() || 'TEXT'}
          </Txt>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <Txt style={[styles.text, { color: ink }]}>{text ?? 'Loading...'}</Txt>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  wrap: { padding: Spacing.md, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  page: {
    width: '100%',
    maxWidth: 920,
    minHeight: 520,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  text: {
    padding: Spacing.md,
    fontFamily: Fonts.mono,
    fontSize: 13,
    lineHeight: 21,
  },
  tableRow: { flexDirection: 'row' },
  webShell: {
    flex: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  webView: { flex: 1, backgroundColor: '#FFFFFF' },
  cell: {
    minWidth: 132,
    maxWidth: 260,
    minHeight: 36,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    justifyContent: 'center',
  },
  headCell: { backgroundColor: '#EAF0F6' },
});
