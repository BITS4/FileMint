/**
 * Native: Office documents can't be rendered in-process, so they're converted
 * to PDF on the server and shown in the PDF viewer. The web build renders
 * Word/Excel locally and uses PDF conversion with a safe PowerPoint outline fallback.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { EmptyState, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

import { PdfView } from './PdfView';

export interface OfficeViewProps {
  file: FileItem;
  night?: boolean;
}

export function OfficeView({ file, night }: OfficeViewProps) {
  const theme = useTheme();
  const [previewKey, setPreviewKey] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    let created: string | undefined;
    setError(undefined);
    setPreviewKey(undefined);
    (async () => {
      try {
        const uri = await storage.getUri(file.storageKey);
        const res = await convertFile({
          endpoint: 'convert',
          fileUri: uri,
          fileName: file.name,
          mime: file.mime,
          fields: { target: 'pdf' },
        });
        const ref = await storage.saveBytes(res.bytes, 'pdf');
        created = ref.key;
        if (!alive) {
          storage.remove(ref.key).catch(() => undefined);
          return;
        }
        setPreviewKey(ref.key);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Preview failed.');
      }
    })();
    return () => {
      alive = false;
      if (created) storage.remove(created).catch(() => undefined);
    };
  }, [file.mime, file.modifiedAt, file.name, file.size, file.storageKey]);

  if (previewKey) return <PdfView storageKey={previewKey} night={night} />;
  if (error) {
    return (
      <View style={styles.center}>
        <EmptyState icon="file-eye-outline" title="Preview unavailable" subtitle={error} compact />
      </View>
    );
  }
  return (
    <View style={styles.center}>
      <ActivityIndicator color={theme.primary} size="large" />
      <Txt variant="caption" muted style={{ marginTop: Spacing.md }}>
        Generating preview...
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
