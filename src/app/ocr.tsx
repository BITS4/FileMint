import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { AppHeader, Button, Card, Icon, ProgressBar, Screen, Txt } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import { baseName } from '@/lib/format';
import * as haptics from '@/lib/haptics';
import { prepareImageForPdf } from '@/lib/image';
import { recognizeImage } from '@/lib/ocr';
import { renderPdfToImages } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import { decodeUtf8, encodeUtf8 } from '@/lib/text';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import type { FileItem } from '@/types';

export default function OcrScreen() {
  const router = useRouter();
  const theme = useTheme();
  const lang = useSettings((s) => s.ocrLanguage);
  const [file, setFile] = useState<FileItem | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    if (!file) return;
    setError(undefined);
    setText(null);
    setSaved(false);
    setRunning(true);
    setProgress(0);
    try {
      let out = '';
      if (file.kind === 'image') {
        const image = await prepareImageForPdf(file.storageKey, file.ext);
        const url = URL.createObjectURL(
          new Blob([image.bytes as unknown as BlobPart], {
            type: image.ext === 'png' ? 'image/png' : 'image/jpeg',
          }),
        );
        try {
          out = await recognizeImage(url, lang, setProgress);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else if (file.kind === 'pdf') {
        try {
          const bytes = await storage.readBytes(file.storageKey);
          const images = await renderPdfToImages(bytes, 'png', 2, (p) => setProgress(p * 0.3));
          let acc = '';
          for (let i = 0; i < images.length; i++) {
            const url = URL.createObjectURL(new Blob([images[i].bytes as unknown as BlobPart]));
            acc +=
              (await recognizeImage(url, lang, (p) => setProgress(0.3 + ((i + p) / images.length) * 0.7))) +
              '\n\n';
            URL.revokeObjectURL(url);
          }
          out = acc.trim();
        } catch {
          const uri = await storage.getUri(file.storageKey);
          const res = await convertFile({
            endpoint: 'pdf/text',
            fileUri: uri,
            fileName: file.name,
            mime: file.mime,
            fields: { language: lang || 'auto' },
          });
          out = decodeUtf8(res.bytes);
          setProgress(1);
        }
      } else {
        throw new Error('Pick an image or a PDF to read.');
      }
      setText(out);
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed.');
      haptics.error();
    } finally {
      setRunning(false);
    }
  };

  const copy = () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard && text) {
      navigator.clipboard.writeText(text);
      haptics.success();
    }
  };

  const saveTxt = async () => {
    if (!text || !file) return;
    await useLibrary.getState().saveResult({
      bytes: encodeUtf8(text),
      name: `${baseName(file.name)} OCR.txt`,
      ext: 'txt',
      kind: 'text',
      mime: 'text/plain',
      source: 'convert',
    });
    setSaved(true);
    haptics.success();
  };

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="OCR / Extract Text" showBack />

      <View style={[styles_banner(theme)]}>
        <Icon name="information-outline" size={16} color={theme.primary} />
        <Txt variant="caption" style={{ color: theme.primary, flex: 1 }}>
          Text recognition runs in the web app. To bake a text layer into a scanned PDF, use{' '}
          <Txt
            variant="caption"
            style={{ color: theme.primary, fontWeight: '700' }}
            onPress={() => router.push('/tool/pdf-to-searchable')}
          >
            Searchable PDF
          </Txt>
          .
        </Txt>
      </View>

      {!file ? (
        <PickFile
          onPicked={setFile}
          kinds={['image', 'pdf']}
          deviceTypes={['image/*', 'application/pdf']}
          title="Select an image or PDF"
          subtitle="FileMint will read the text it contains."
          icon="text-recognition"
        />
      ) : (
        <View style={{ gap: Spacing.md }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <Icon name="file-check-outline" size={20} color={theme.primary} />
            <Txt variant="body" weight="600" numberOfLines={1} style={{ flex: 1 }}>
              {file.name}
            </Txt>
            <Txt
              variant="caption"
              style={{ color: theme.primary }}
              onPress={() => {
                setFile(null);
                setText(null);
              }}
            >
              Change
            </Txt>
          </Card>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Txt variant="caption" muted>
              Language · {lang.toUpperCase()}
            </Txt>
            <Txt variant="caption" style={{ color: theme.primary }} onPress={() => router.push('/settings')}>
              Change
            </Txt>
          </View>

          {!running ? (
            <Button title="Extract text" icon="text-recognition" onPress={run} full size="lg" />
          ) : (
            <Card style={{ gap: Spacing.sm }}>
              <Txt variant="body" weight="600">
                Reading text…
              </Txt>
              <ProgressBar progress={progress} indeterminate={progress <= 0} />
              <Txt variant="caption" muted>
                {Math.round(progress * 100)}%
              </Txt>
            </Card>
          )}

          {error ? (
            <Card style={{ borderColor: theme.danger, gap: 4 }}>
              <Txt variant="label" style={{ color: theme.danger }}>
                Could not extract text
              </Txt>
              <Txt variant="caption" muted>
                {error}
              </Txt>
            </Card>
          ) : null}

          {text !== null ? (
            <Card style={{ gap: Spacing.md }}>
              <Txt variant="h3">Result</Txt>
              <Txt selectable style={{ color: theme.text, lineHeight: 21 }}>
                {text || '(No text found)'}
              </Txt>
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                {Platform.OS === 'web' ? (
                  <Button
                    title="Copy"
                    icon="content-copy"
                    variant="secondary"
                    onPress={copy}
                    style={{ flex: 1 }}
                  />
                ) : null}
                <Button
                  title={saved ? 'Saved' : 'Save as TXT'}
                  icon={saved ? 'check' : 'content-save-outline'}
                  onPress={saveTxt}
                  disabled={saved || !text}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function styles_banner(theme: { primaryMuted: string }) {
  return {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: 14,
    marginBottom: Spacing.md,
    backgroundColor: theme.primaryMuted,
  };
}
