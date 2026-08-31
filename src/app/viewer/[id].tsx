import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { FileActionsSheet } from '@/components/files/FileActionsSheet';
import { AppHeader, Button, EmptyState, IconButton, Screen } from '@/components/ui';
import { OfficeView } from '@/components/viewer/OfficeView';
import { PdfView } from '@/components/viewer/PdfView';
import { TextDocumentView } from '@/components/viewer/TextDocumentView';
import { Spacing } from '@/constants/theme';
import { goBack } from '@/lib/nav';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileKind } from '@/types';

const OFFICE_KINDS: FileKind[] = ['word', 'excel', 'ppt'];
const READABLE_EXTS = new Set([
  'txt',
  'md',
  'markdown',
  'html',
  'htm',
  'json',
  'xml',
  'yaml',
  'yml',
  'log',
  'ini',
  'cfg',
  'conf',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'sh',
  'bat',
  'ps1',
  'sql',
]);

export default function ViewerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const file = useLibrary((s) => s.files.find((f) => f.id === id));
  const touch = useLibrary((s) => s.touch);

  const [night, setNight] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [imageUri, setImageUri] = useState<string | undefined>(undefined);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    if (file) touch(file.id);
  }, [file?.id]);

  useEffect(() => {
    if (!file) return;
    setImageUri(undefined);
    setImageSize(null);
    if (file.kind === 'image') {
      storage
        .getUri(file.storageKey)
        .then((uri) => {
          setImageUri(uri);
          Image.getSize(
            uri,
            (width, height) => setImageSize({ width, height }),
            () => setImageSize(null),
          );
        })
        .catch(() => undefined);
    }
  }, [file?.id]);

  if (!file) {
    return (
      <Screen padded>
        <AppHeader showBack />
        <EmptyState
          icon="file-remove-outline"
          title="File unavailable"
          subtitle="It may have been moved to Trash or deleted."
          actionLabel="Go back"
          onAction={goBack}
        />
      </Screen>
    );
  }

  const isPdf = file.kind === 'pdf';
  const isOffice = OFFICE_KINDS.includes(file.kind);
  const isReadableText = file.kind === 'text' || file.kind === 'csv' || READABLE_EXTS.has(file.ext);
  const editable = isPdf || isOffice || file.kind === 'text' || file.kind === 'csv';
  const editRoute = isPdf
    ? `/pdf-editor?file=${encodeURIComponent(file.id)}&tool=annotate`
    : `/edit/${file.id}`;
  const shareSupported = canShareFiles();
  const imageBox = getContainedSize({
    source: imageSize,
    maxWidth: Math.max(240, windowWidth - Spacing.lg * 2),
    maxHeight: Math.max(320, windowHeight - 170),
  });

  return (
    <Screen edges={['top']}>
      <View style={styles.header}>
        <AppHeader
          title={file.name}
          showBack
          right={
            <>
              {isPdf || isReadableText ? (
                <IconButton
                  name={night ? 'white-balance-sunny' : 'weather-night'}
                  onPress={() => setNight((n) => !n)}
                  accessibilityLabel="Toggle night mode"
                />
              ) : null}
              {editable ? (
                <IconButton
                  name="pencil-outline"
                  onPress={() => router.push(editRoute as never)}
                  accessibilityLabel="Edit"
                />
              ) : null}
              <IconButton
                name="download-outline"
                onPress={() => void downloadFile(file)}
                accessibilityLabel="Download"
              />
              <IconButton
                name="share-variant"
                onPress={() => void shareFile(file)}
                accessibilityLabel="Share"
                disabled={!shareSupported}
              />
              <IconButton
                name="dots-vertical"
                onPress={() => setShowActions(true)}
                accessibilityLabel="More"
              />
            </>
          }
        />
      </View>

      <View style={styles.body}>
        {isPdf ? (
          <PdfView storageKey={file.storageKey} night={night} />
        ) : isOffice ? (
          <OfficeView file={file} night={night} />
        ) : file.kind === 'image' && imageUri ? (
          <ScrollView
            style={styles.fill}
            contentContainerStyle={styles.imageWrap}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
          >
            <Image source={{ uri: imageUri }} style={[styles.image, imageBox]} resizeMode="contain" />
          </ScrollView>
        ) : isReadableText ? (
          <TextDocumentView file={file} night={night} />
        ) : (
          <View style={styles.unsupported}>
            <EmptyState
              icon="file-eye-outline"
              title="Preview not available"
              subtitle={`FileMint cannot preview ${file.ext.toUpperCase()} files directly. Open it in another app.`}
            />
            <View style={{ gap: Spacing.sm, marginTop: Spacing.lg }}>
              <Button
                title="Download"
                icon="download-outline"
                variant="secondary"
                onPress={() => void downloadFile(file)}
                full
              />
              <Button
                title="Share"
                icon="share-variant"
                variant="secondary"
                onPress={() => void shareFile(file)}
                disabled={!shareSupported}
                full
              />
            </View>
          </View>
        )}
      </View>

      <FileActionsSheet file={showActions ? file : null} onClose={() => setShowActions(false)} />
    </Screen>
  );
}

function getContainedSize({
  source,
  maxWidth,
  maxHeight,
}: {
  source: { width: number; height: number } | null;
  maxWidth: number;
  maxHeight: number;
}) {
  if (!source?.width || !source.height) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: Spacing.lg },
  body: { flex: 1 },
  fill: { flex: 1 },
  imageWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
  image: { borderRadius: 10 },
  unsupported: { flex: 1, padding: Spacing.lg },
});
