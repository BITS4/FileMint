import { useLocalSearchParams } from 'expo-router';
import JSZip from 'jszip';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { PickFile } from '@/components/tools/PickFile';
import { ToolOutcome } from '@/components/tools/ToolOutcome';
import { AppHeader, Button, Icon, IconButton, Screen, TileGrid, Txt } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import { baseName } from '@/lib/format';
import { buildFromPageModel, getPageCount } from '@/lib/pdf';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import { uid } from '@/lib/uid';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

interface PageItem {
  key: string;
  srcIndex: number | null;
  rotation: number;
}

type ThumbStatus = 'idle' | 'loading' | 'ready' | 'failed';

const FOCUS_HINT: Record<string, string> = {
  reorder: 'Select a page, then use the arrows to move it.',
  delete: 'Select pages, then tap the trash icon.',
  rotate: 'Select pages, then tap rotate.',
  extract: 'Delete the pages you don’t need, then apply to keep the rest.',
  duplicate: 'Select pages, then tap duplicate.',
  insert: 'Tap “Add blank” to insert an empty page.',
};

function imageToUri(image: RenderedImage) {
  return dataUrl(image.ext === 'jpg' ? 'image/jpeg' : 'image/png', image.bytes);
}

function thumbnailMap(images: RenderedImage[], limit: number) {
  const out: Record<number, string> = {};
  images.slice(0, limit).forEach((image, index) => {
    out[index] = imageToUri(image);
  });
  return out;
}

async function renderThumbnailsWithServer(file: FileItem, limit: number): Promise<Record<number, string>> {
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { format: 'jpg', dpi: 96 },
  });
  const zip = await JSZip.loadAsync(res.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.(jpe?g)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const images: RenderedImage[] = [];
  for (const entry of entries.slice(0, limit)) {
    images.push({ bytes: await entry.async('uint8array'), ext: 'jpg' });
  }
  if (!images.length) throw new Error('The server did not return page previews.');
  return thumbnailMap(images, limit);
}

export default function ManagePagesScreen() {
  const theme = useTheme();
  const runner = useRunner();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const [file, setFile] = useState<FileItem | null>(null);
  const [pages, setPages] = useState<PageItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [thumbStatus, setThumbStatus] = useState<ThumbStatus>('idle');
  const thumbJob = useRef(0);

  const onPicked = async (f: FileItem) => {
    const job = thumbJob.current + 1;
    thumbJob.current = job;
    setFile(f);
    setSelected([]);
    setThumbs({});
    setThumbStatus('loading');
    const bytes = await storage.readBytes(f.storageKey);
    const count = await getPageCount(bytes);
    setPages(Array.from({ length: count }, (_, i) => ({ key: uid('p_'), srcIndex: i, rotation: 0 })));
    void loadThumbnails(job, f, bytes, count);
  };

  const loadThumbnails = async (job: number, f: FileItem, bytes: Uint8Array, count: number) => {
    try {
      const images = await renderPdfToImages(new Uint8Array(bytes), 'jpg', 0.7);
      if (thumbJob.current !== job) return;
      setThumbs(thumbnailMap(images, count));
      setThumbStatus('ready');
    } catch {
      try {
        const serverThumbs = await renderThumbnailsWithServer(f, count);
        if (thumbJob.current !== job) return;
        setThumbs(serverThumbs);
        setThumbStatus('ready');
      } catch {
        if (thumbJob.current !== job) return;
        setThumbStatus('failed');
      }
    }
  };

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const rotate = () =>
    setPages((prev) => prev.map((p) => (selected.includes(p.key) ? { ...p, rotation: p.rotation + 90 } : p)));
  const remove = () => {
    setPages((prev) => prev.filter((p) => !selected.includes(p.key)));
    setSelected([]);
  };
  const duplicate = () => {
    setPages((prev) => {
      const out: PageItem[] = [];
      for (const p of prev) {
        out.push(p);
        if (selected.includes(p.key))
          out.push({ key: uid('p_'), srcIndex: p.srcIndex, rotation: p.rotation });
      }
      return out;
    });
    setSelected([]);
  };
  const addBlank = () => setPages((prev) => [...prev, { key: uid('p_'), srcIndex: null, rotation: 0 }]);
  const moveSelected = (dir: -1 | 1) =>
    setPages((prev) => {
      if (selected.length !== 1) return prev;
      const idx = prev.findIndex((p) => p.key === selected[0]);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });

  const run = () =>
    runner.run(async (onProgress) => {
      if (!file) throw new Error('No file selected.');
      if (pages.length === 0) throw new Error('The document has no pages left.');
      const bytes = await storage.readBytes(file.storageKey);
      onProgress(0.3);
      const out = await buildFromPageModel(
        bytes,
        pages.map((p) => ({ srcIndex: p.srcIndex, rotation: p.rotation })),
      );
      onProgress(0.85);
      return useLibrary.getState().saveResult({
        bytes: out,
        name: `${baseName(file.name)} edited.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: pages.length,
      });
    });

  const editing = !!file && runner.state !== 'done' && runner.state !== 'running';
  const single = selected.length === 1;

  const toolbar = editing ? (
    <View
      style={[styles.toolbarWrap, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}
    >
      <View style={styles.toolbar}>
        <ToolBtn icon="arrow-left" label="Move" disabled={!single} onPress={() => moveSelected(-1)} />
        <ToolBtn icon="arrow-right" label="Move" disabled={!single} onPress={() => moveSelected(1)} />
        <ToolBtn icon="rotate-right" label="Rotate" disabled={!selected.length} onPress={rotate} />
        <ToolBtn icon="content-duplicate" label="Copy" disabled={!selected.length} onPress={duplicate} />
        <ToolBtn icon="file-plus-outline" label="Blank" onPress={addBlank} />
        <ToolBtn
          icon="trash-can-outline"
          label="Delete"
          disabled={!selected.length}
          danger
          onPress={remove}
        />
      </View>
      <Button
        title={`Apply (${pages.length} page${pages.length === 1 ? '' : 's'})`}
        icon="check"
        onPress={run}
        disabled={pages.length === 0}
        full
      />
    </View>
  ) : undefined;

  return (
    <Screen padded scroll={editing} edges={['top']} footer={toolbar}>
      <AppHeader
        title="Manage Pages"
        showBack
        right={
          file && editing ? (
            <IconButton
              name={
                selected.length === pages.length && pages.length
                  ? 'checkbox-multiple-marked-outline'
                  : 'checkbox-multiple-blank-outline'
              }
              onPress={() => setSelected(selected.length === pages.length ? [] : pages.map((p) => p.key))}
              accessibilityLabel="Select all"
            />
          ) : undefined
        }
      />

      {!file ? (
        <PickFile
          onPicked={onPicked}
          title="Select a PDF to edit"
          subtitle="Reorder, rotate, delete, duplicate or add blank pages."
        />
      ) : runner.state === 'done' || runner.state === 'running' ? (
        <ToolOutcome runner={runner} runningLabel="Saving changes…" doneLabel="Pages updated" />
      ) : (
        <>
          {focus && FOCUS_HINT[focus] ? (
            <View style={[styles.hint, { backgroundColor: theme.primaryMuted }]}>
              <Icon name="information-outline" size={16} color={theme.primary} />
              <Txt variant="caption" style={{ color: theme.primary, flex: 1 }}>
                {FOCUS_HINT[focus]}
              </Txt>
            </View>
          ) : null}
          <View style={styles.gridWrap}>
            <TileGrid
              items={pages}
              columns={3}
              gap={Spacing.sm}
              keyExtractor={(p) => p.key}
              renderItem={(item, _w, index) => (
                <PageCard
                  index={index}
                  label={item.srcIndex === null ? 'Blank' : `p.${item.srcIndex + 1}`}
                  rotation={item.rotation}
                  selected={selected.includes(item.key)}
                  thumbnailUri={item.srcIndex === null ? undefined : thumbs[item.srcIndex]}
                  thumbnailStatus={thumbStatus}
                  onPress={() => toggle(item.key)}
                />
              )}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function ToolBtn({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const theme = useTheme();
  const color = disabled ? theme.textMuted : danger ? theme.danger : theme.text;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.toolBtn}>
      <Icon name={icon} size={22} color={color} />
      <Txt variant="tiny" style={{ color, marginTop: 2 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

function PageCard({
  index,
  label,
  rotation,
  selected,
  thumbnailUri,
  thumbnailStatus,
  onPress,
}: {
  index: number;
  label: string;
  rotation: number;
  selected: boolean;
  thumbnailUri?: string;
  thumbnailStatus: ThumbStatus;
  onPress: () => void;
}) {
  const theme = useTheme();
  const rot = ((rotation % 360) + 360) % 360;
  const isBlank = !thumbnailUri && label === 'Blank';
  const showLoading = !thumbnailUri && !isBlank && thumbnailStatus === 'loading';
  const showFailed = !thumbnailUri && !isBlank && thumbnailStatus === 'failed';
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.page,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: selected ? theme.primary : theme.border,
          borderWidth: selected ? 2 : 1,
        },
      ]}
    >
      <View style={[styles.paper, { backgroundColor: isBlank ? theme.background : '#fff' }]}>
        {thumbnailUri ? (
          <Image
            source={{ uri: thumbnailUri }}
            resizeMode="contain"
            style={[styles.thumbnail, rot ? { transform: [{ rotate: `${rot}deg` }] } : null]}
          />
        ) : (
          <View style={styles.placeholder}>
            {showLoading ? <ActivityIndicator color={theme.primary} /> : null}
            <Txt variant="title" muted={!isBlank}>
              {index + 1}
            </Txt>
            <Txt variant="tiny" muted>
              {isBlank ? 'Blank page' : showFailed ? 'Preview unavailable' : 'Rendering preview'}
            </Txt>
          </View>
        )}
      </View>
      <View
        style={[styles.indexBadge, { backgroundColor: selected ? theme.primary : theme.backgroundElevated }]}
      >
        <Txt variant="tiny" style={{ color: selected ? theme.primaryText : theme.text }}>
          {index + 1}
        </Txt>
      </View>
      <View style={[styles.pageLabel, { backgroundColor: theme.backgroundElevated }]}>
        <Txt variant="tiny" muted numberOfLines={1}>
          {label}
        </Txt>
      </View>
      {rot !== 0 ? (
        <View style={[styles.rotBadge, { backgroundColor: theme.primary }]}>
          <Txt variant="tiny" style={{ color: theme.primaryText }}>
            {rot}°
          </Txt>
        </View>
      ) : null}
      {selected ? (
        <View style={[styles.check, { backgroundColor: theme.primary }]}>
          <Icon name="check" size={13} color={theme.primaryText} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  gridWrap: { paddingBottom: Spacing.lg },
  page: { aspectRatio: 0.72, borderRadius: Radius.md, padding: 8, overflow: 'hidden' },
  paper: {
    flex: 1,
    width: '100%',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnail: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  indexBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    minWidth: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  pageLabel: {
    position: 'absolute',
    bottom: 10,
    alignSelf: 'center',
    maxWidth: '78%',
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  rotBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.xs,
  },
  check: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarWrap: {
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between' },
  toolBtn: { alignItems: 'center', flex: 1, paddingVertical: Spacing.xs },
});
