import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  IconButton,
  Screen,
  Segmented,
  type SegmentedOption,
  SectionHeader,
  TextField,
  Thumbnail,
  Txt,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { withExt } from '@/lib/format';
import { prepareImageForPdf } from '@/lib/image';
import { type Orientation, type PageSizeKey, imagesToPdf } from '@/lib/pdf';
import { importIntoLibrary, pickImages } from '@/lib/pick';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

const SIZE_OPTIONS: SegmentedOption<PageSizeKey>[] = [
  { label: 'A4', value: 'a4' },
  { label: 'Letter', value: 'letter' },
  { label: 'Fit image', value: 'fit' },
];
const ORIENTATION_OPTIONS: SegmentedOption<Orientation>[] = [
  { label: 'Portrait', value: 'portrait', icon: 'crop-portrait' },
  { label: 'Landscape', value: 'landscape', icon: 'crop-landscape' },
];
const MARGIN_OPTIONS: SegmentedOption<'none' | 'small' | 'large'>[] = [
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'small' },
  { label: 'Large', value: 'large' },
];
const FIT_OPTIONS: SegmentedOption<'contain' | 'cover' | 'stretch'>[] = [
  { label: 'Fit', value: 'contain' },
  { label: 'Crop fill', value: 'cover' },
  { label: 'Stretch', value: 'stretch' },
];
const FILTER_OPTIONS: SegmentedOption<'none' | 'grayscale' | 'contrast' | 'bw'>[] = [
  { label: 'Normal', value: 'none' },
  { label: 'Gray', value: 'grayscale' },
  { label: 'Contrast', value: 'contrast' },
  { label: 'B/W', value: 'bw' },
];
type ImageRotation = '0' | '90' | '180' | '270';
const ROTATE_OPTIONS: SegmentedOption<ImageRotation>[] = [
  { label: '0', value: '0' },
  { label: '90', value: '90' },
  { label: '180', value: '180' },
  { label: '270', value: '270' },
];

export default function ImageToPdfScreen() {
  const theme = useTheme();
  const runner = useRunner();
  const [images, setImages] = useState<FileItem[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeKey>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [marginKey, setMarginKey] = useState<'none' | 'small' | 'large'>('small');
  const [fit, setFit] = useState<'contain' | 'cover' | 'stretch'>('contain');
  const [filter, setFilter] = useState<'none' | 'grayscale' | 'contrast' | 'bw'>('none');
  const [imageRotation, setImageRotation] = useState<ImageRotation>('0');
  const [name, setName] = useState('My document');

  const addFromGallery = async () => {
    const picked = await pickImages({ multiple: true });
    const imported: FileItem[] = [];
    for (const p of picked) imported.push(await importIntoLibrary(p, 'import'));
    setImages((prev) => [...prev, ...imported]);
  };

  const move = (index: number, dir: -1 | 1) =>
    setImages((prev) => {
      const arr = [...prev];
      const j = index + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[index], arr[j]] = [arr[j], arr[index]];
      return arr;
    });

  const removeImage = (id: string) => setImages((prev) => prev.filter((f) => f.id !== id));

  const margin = marginKey === 'none' ? 0 : marginKey === 'small' ? 24 : 48;

  const run = () =>
    runner.run(async (onProgress) => {
      const prepared = [];
      for (let i = 0; i < images.length; i++) {
        prepared.push(await prepareImageForPdf(images[i].storageKey, images[i].ext, { rotate: Number(imageRotation) as 0 | 90 | 180 | 270, filter }));
        onProgress(((i + 1) / (images.length + 1)) * 0.75);
      }
      const pdf = await imagesToPdf(prepared, { pageSize, orientation, margin, fit });
      onProgress(0.9);
      const file = await useLibrary.getState().saveResult({
        bytes: pdf,
        name: withExt(name || 'My document', 'pdf'),
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: images.length,
      });
      onProgress(1);
      return file;
    });

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 40 }}>
      <AppHeader title="Image to PDF" showBack />

      {runner.state !== 'done' ? (
        <>
          {images.length === 0 ? (
            <PickFile
              onPicked={(f) => setImages((prev) => [...prev, f])}
              kinds={['image']}
              deviceTypes="image/*"
              title="Add images"
              subtitle="Pick photos to combine into a single PDF. Reorder them before exporting."
              icon="image-multiple"
            />
          ) : (
            <>
              <SectionHeader
                title={`${images.length} image${images.length === 1 ? '' : 's'}`}
                actionLabel="Add more"
                onAction={addFromGallery}
              />
              <Card padded={false} style={{ paddingVertical: 4, paddingHorizontal: 6 }}>
                {images.map((file, index) => (
                  <View key={file.id} style={styles.imageRow}>
                    <Thumbnail file={file} size={46} />
                    <Txt variant="body" weight="600" style={{ flex: 1 }} numberOfLines={1}>
                      Page {index + 1}
                    </Txt>
                    <IconButton name="arrow-up" size={20} color={theme.textSecondary} disabled={index === 0} onPress={() => move(index, -1)} />
                    <IconButton name="arrow-down" size={20} color={theme.textSecondary} disabled={index === images.length - 1} onPress={() => move(index, 1)} />
                    <IconButton name="close" size={20} color={theme.danger} onPress={() => removeImage(file.id)} />
                  </View>
                ))}
              </Card>

              <SectionHeader title="Page setup" />
              <View style={{ gap: Spacing.md }}>
                <Field label="Page size">
                  <Segmented options={SIZE_OPTIONS} value={pageSize} onChange={setPageSize} />
                </Field>
                {pageSize !== 'fit' ? (
                  <Field label="Orientation">
                    <Segmented options={ORIENTATION_OPTIONS} value={orientation} onChange={setOrientation} />
                  </Field>
                ) : null}
                <Field label="Margin">
                  <Segmented options={MARGIN_OPTIONS} value={marginKey} onChange={setMarginKey} />
                </Field>
                <Field label="Image fit / crop">
                  <Segmented options={FIT_OPTIONS} value={fit} onChange={setFit} />
                </Field>
                <Field label="Filter">
                  <Segmented options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
                </Field>
                <Field label="Rotate images">
                  <Segmented options={ROTATE_OPTIONS} value={imageRotation} onChange={setImageRotation} />
                </Field>
                <TextField label="File name" value={name} onChangeText={setName} placeholder="My document" />
              </View>

              <Button
                title="Create PDF"
                icon="file-pdf-box"
                onPress={run}
                loading={runner.state === 'running'}
                disabled={images.length === 0}
                full
                size="lg"
                style={{ marginTop: Spacing.lg }}
              />
            </>
          )}
        </>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Building your PDF…" doneLabel="PDF created" />
    </Screen>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: Spacing.xs }}>
      <Txt variant="label" muted style={{ marginLeft: 2 }}>
        {label}
      </Txt>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm },
});
