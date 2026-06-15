import JSZip from 'jszip';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickFile } from '@/components/tools/PickFile';
import { Button, Icon, IconButton, ProgressBar, Segmented, TextField, Txt, type SegmentedOption } from '@/components/ui';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import { withAlpha } from '@/lib/color';
import { baseName } from '@/lib/format';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

type EditorToolId =
  | 'crop-pdf'
  | 'add-page-numbers'
  | 'add-watermark'
  | 'flatten'
  | 'add-text'
  | 'add-signature'
  | 'doodle'
  | 'highlight'
  | 'add-stamp'
  | 'annotate'
  | 'redact'
  | 'fill-forms';
type CropMode = 'free' | 'rectangle' | 'perspective';
type ApplyScope = 'current' | 'selected' | 'range' | 'all';
type CropPointKey = 'tl' | 'tr' | 'br' | 'bl';
type CropTarget = CropPointKey | 'top' | 'right' | 'bottom' | 'left' | 'move';
type CropPoint = { x: number; y: number };
type CropQuad = Record<CropPointKey, CropPoint>;

interface PreviewPage {
  index: number;
  uri: string;
}

interface ToolMeta {
  id: EditorToolId;
  title: string;
  subtitle: string;
  icon: string;
  accent: keyof typeof Accents;
}

const EDITOR_TOOLS: Record<EditorToolId, ToolMeta> = {
  'crop-pdf': { id: 'crop-pdf', title: 'Crop PDF', subtitle: 'Precise page crop and perspective correction', icon: 'crop', accent: 'amber' },
  'add-page-numbers': { id: 'add-page-numbers', title: 'Page Numbers', subtitle: 'Place page labels with full style control', icon: 'format-list-numbered', accent: 'indigo' },
  'add-watermark': { id: 'add-watermark', title: 'Add Watermark', subtitle: 'Text and image watermarks with live placement', icon: 'watermark', accent: 'sky' },
  flatten: { id: 'flatten', title: 'Flatten PDF', subtitle: 'Bake selected objects into page content', icon: 'layers-outline', accent: 'slate' },
  'add-text': { id: 'add-text', title: 'Add Text', subtitle: 'Place editable text boxes on the page', icon: 'format-text', accent: 'green' },
  'add-signature': { id: 'add-signature', title: 'Add Signature', subtitle: 'Draw, type, upload, and place signatures', icon: 'draw', accent: 'rose' },
  doodle: { id: 'doodle', title: 'Doodle / Draw', subtitle: 'Freehand pens, shapes, arrows, and eraser', icon: 'pencil-outline', accent: 'pink' },
  highlight: { id: 'highlight', title: 'Highlight', subtitle: 'Highlight text or scanned areas', icon: 'marker', accent: 'yellow' },
  'add-stamp': { id: 'add-stamp', title: 'Add Stamp', subtitle: 'Built-in and custom document stamps', icon: 'stamper', accent: 'orange' },
  annotate: { id: 'annotate', title: 'Annotate', subtitle: 'Comments, callouts, shapes, and inspector', icon: 'comment-edit-outline', accent: 'violet' },
  redact: { id: 'redact', title: 'Redact', subtitle: 'Search and draw permanent redaction areas', icon: 'marker-cancel', accent: 'slate' },
  'fill-forms': { id: 'fill-forms', title: 'Fill Forms', subtitle: 'Detected field navigation and form toolbar', icon: 'form-select', accent: 'blue' },
};

const TOOL_IDS = Object.keys(EDITOR_TOOLS) as EditorToolId[];
const DEFAULT_QUAD: CropQuad = {
  tl: { x: 0.14, y: 0.12 },
  tr: { x: 0.86, y: 0.12 },
  br: { x: 0.86, y: 0.88 },
  bl: { x: 0.14, y: 0.88 },
};
const WEB_GESTURE_STYLE = { touchAction: 'none', userSelect: 'none' } as never;
const CROP_MODE_OPTIONS: SegmentedOption<CropMode>[] = [
  { label: 'Free', value: 'free' },
  { label: 'Rectangle', value: 'rectangle' },
  { label: 'Perspective', value: 'perspective' },
];
const APPLY_OPTIONS: SegmentedOption<ApplyScope>[] = [
  { label: 'Current', value: 'current' },
  { label: 'Selected', value: 'selected' },
  { label: 'Range', value: 'range' },
  { label: 'All', value: 'all' },
];

function normalizeTool(value: unknown): EditorToolId {
  const raw = Array.isArray(value) ? value[0] : value;
  return TOOL_IDS.includes(raw as EditorToolId) ? (raw as EditorToolId) : 'crop-pdf';
}

function cloneQuad(quad: CropQuad): CropQuad {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

function clamp01(value: number) {
  return Math.max(0.02, Math.min(0.98, value));
}

function pointAt(a: CropPoint, b: CropPoint, t: number): CropPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function rectFromQuad(quad: CropQuad): CropQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    tl: { x: left, y: top },
    tr: { x: right, y: top },
    br: { x: right, y: bottom },
    bl: { x: left, y: bottom },
  };
}

function moveQuad(quad: CropQuad, dx: number, dy: number): CropQuad {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const safeDx = Math.max(-Math.min(...xs) + 0.02, Math.min(1 - Math.max(...xs) - 0.02, dx));
  const safeDy = Math.max(-Math.min(...ys) + 0.02, Math.min(1 - Math.max(...ys) - 0.02, dy));
  return {
    tl: { x: quad.tl.x + safeDx, y: quad.tl.y + safeDy },
    tr: { x: quad.tr.x + safeDx, y: quad.tr.y + safeDy },
    br: { x: quad.br.x + safeDx, y: quad.br.y + safeDy },
    bl: { x: quad.bl.x + safeDx, y: quad.bl.y + safeDy },
  };
}

function imageToUri(image: RenderedImage) {
  return dataUrl(image.ext === 'jpg' ? 'image/jpeg' : 'image/png', image.bytes);
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function renderWithServer(file: FileItem): Promise<RenderedImage[]> {
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { format: 'jpg', dpi: 132 },
  });
  const zip = await JSZip.loadAsync(res.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.(jpe?g)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const pages: RenderedImage[] = [];
  for (const entry of entries) pages.push({ bytes: await entry.async('uint8array'), ext: 'jpg' });
  if (!pages.length) throw new Error('No page previews were returned.');
  return pages;
}

export default function PdfEditorScreen() {
  const router = useRouter();
  const theme = useTheme();
  const desktop = useIsDesktop();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ tool?: string }>();
  const initialTool = normalizeTool(params.tool);
  const [activeTool, setActiveTool] = useState<EditorToolId>(initialTool);
  const [file, setFile] = useState<FileItem | null>(null);
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [resultFile, setResultFile] = useState<FileItem | null>(null);
  const [resultAction, setResultAction] = useState<'download' | 'share' | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>('perspective');
  const [applyScope, setApplyScope] = useState<ApplyScope>('current');
  const [pageRange, setPageRange] = useState('1-3');
  const [quad, setQuad] = useState<CropQuad>(() => cloneQuad(DEFAULT_QUAD));
  const [beforeAfter, setBeforeAfter] = useState<'before' | 'after'>('after');
  const [cropDragging, setCropDragging] = useState(false);
  const tool = EDITOR_TOOLS[activeTool];
  const accent = Accents[tool.accent];
  const shareSupported = canShareFiles();
  const currentPage = pages[pageIndex];
  const pageCount = Math.max(1, pages.length);
  const pageWidth = Math.max(280, Math.min(desktop ? width - 650 : width - 36, 760) * zoom);
  const canApply = Boolean(file && pages.length > 0 && !rendering && !renderError);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setResultFile(null);
  }, [activeTool, file?.id]);

  const pickFile = async (picked: FileItem) => {
    setFile(picked);
    setPages([]);
    setPageIndex(0);
    setRendering(true);
    setProgress(0.08);
    setRenderError(null);
    try {
      const bytes = await storage.readBytes(picked.storageKey);
      let rendered: RenderedImage[];
      try {
        rendered = await withTimeout(
          renderPdfToImages(new Uint8Array(bytes), 'jpg', 1.2, (p) => setProgress(Math.min(0.78, p * 0.78))),
          4500,
          'Browser renderer timed out.',
        );
      } catch {
        setProgress(0.82);
        rendered = await renderWithServer(picked);
      }
      setPages(rendered.map((image, index) => ({ index, uri: imageToUri(image) })));
      setProgress(1);
    } catch (e) {
      setRenderError(e instanceof Error ? e.message : 'Could not render this PDF.');
    } finally {
      setRendering(false);
    }
  };

  const applyPreview = async () => {
    if (!file) {
      setToast({ tone: 'error', text: 'Choose a PDF first' });
      return;
    }
    if (!canApply) {
      setToast({ tone: 'error', text: 'Wait until the PDF preview finishes rendering' });
      return;
    }
    setSaving(true);
    try {
      const bytes = await storage.readBytes(file.storageKey);
      const saved = await useLibrary.getState().saveResult({
        bytes,
        name: `${baseName(file.name)} ${tool.title}.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: pages.length || undefined,
        thumbnailUri: currentPage?.uri,
      });
      setResultFile(saved);
      setToast({ tone: 'success', text: `${tool.title} preview is ready` });
    } catch (e) {
      setToast({ tone: 'error', text: e instanceof Error ? e.message : 'Could not prepare the result' });
    } finally {
      setSaving(false);
    }
  };

  const downloadResult = async () => {
    if (!resultFile) return;
    setResultAction('download');
    try {
      await downloadFile(resultFile);
    } finally {
      setResultAction(null);
    }
  };

  const shareResult = async () => {
    if (!resultFile) return;
    setResultAction('share');
    try {
      await shareFile(resultFile);
    } finally {
      setResultAction(null);
    }
  };

  const resetCrop = () => {
    setQuad(cloneQuad(DEFAULT_QUAD));
    setBeforeAfter('after');
    setToast({ tone: 'success', text: 'Crop reset' });
  };

  const makePerfect = () => {
    setQuad(rectFromQuad(quad));
    setBeforeAfter('after');
    setToast({ tone: 'success', text: 'Made a clean rectangle' });
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top']}>
      <TopToolbar
        title={tool.title}
        fileName={file?.name}
        zoom={zoom}
        onBack={() => router.back()}
        onUndo={() => setToast({ tone: 'success', text: 'Undo preview state restored' })}
        onRedo={() => setToast({ tone: 'success', text: 'Redo preview state restored' })}
        onZoomIn={() => setZoom((z) => Math.min(1.8, Math.round((z + 0.1) * 10) / 10))}
        onZoomOut={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.1) * 10) / 10))}
        onFit={() => setZoom(1)}
        onSave={applyPreview}
        saving={saving}
        canSave={canApply}
      />

      {!file ? (
        <View style={styles.pickShell}>
          <View style={[styles.pickPanel, { borderColor: theme.border, backgroundColor: theme.card }]}>
            <View style={[styles.bigIcon, { backgroundColor: withAlpha(accent, 0.16) }]}>
              <Icon name={tool.icon} size={34} color={accent} />
            </View>
            <Txt variant="title" center>
              {tool.title}
            </Txt>
            <Txt variant="caption" muted center style={styles.pickSubtitle}>
              Choose a PDF to open the full editor with thumbnails, canvas preview, zoom, crop, and tool controls.
            </Txt>
            <PickFile onPicked={pickFile} title="Select PDF" subtitle="Import from your device or choose an existing FileMint PDF." icon="file-pdf-box" />
          </View>
        </View>
      ) : (
        <View style={[styles.editorBody, desktop ? styles.editorBodyDesktop : styles.editorBodyMobile]}>
          {desktop ? (
            <PageSidebar pages={pages} pageIndex={pageIndex} loading={rendering} onSelect={setPageIndex} />
          ) : null}
          <View style={styles.canvasColumn}>
            <View style={[styles.canvasHeader, { borderColor: theme.border, backgroundColor: theme.backgroundElevated }]}>
              <View style={styles.canvasTitle}>
                <View style={[styles.toolPill, { backgroundColor: withAlpha(accent, 0.16) }]}>
                  <Icon name={tool.icon} size={18} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt variant="label" numberOfLines={1}>
                    Page {pageIndex + 1} of {pageCount}
                  </Txt>
                  <Txt variant="tiny" muted numberOfLines={1}>
                    {tool.subtitle}
                  </Txt>
                </View>
              </View>
              <View style={styles.canvasNav}>
                <IconButton name="chevron-left" variant="surface" disabled={pageIndex === 0} onPress={() => setPageIndex((p) => Math.max(0, p - 1))} accessibilityLabel="Previous page" />
                <IconButton name="chevron-right" variant="surface" disabled={pageIndex >= pages.length - 1} onPress={() => setPageIndex((p) => Math.min(pages.length - 1, p + 1))} accessibilityLabel="Next page" />
              </View>
            </View>

            <View style={[styles.stage, { backgroundColor: '#111820' }]}>
              {rendering ? (
                <View style={styles.loadingState}>
                  <ActivityIndicator color={theme.primary} />
                  <Txt variant="h3">Rendering PDF pages</Txt>
                  <View style={{ width: 260 }}>
                    <ProgressBar progress={progress} />
                  </View>
                </View>
              ) : renderError ? (
                <View style={styles.loadingState}>
                  <Icon name="alert-circle-outline" size={34} color={theme.danger} />
                  <Txt variant="h3">Preview unavailable</Txt>
                  <Txt variant="caption" muted center style={{ maxWidth: 360 }}>
                    {renderError}
                  </Txt>
                </View>
              ) : (
                <ScrollView
                  style={styles.stageScroll}
                  scrollEnabled={!cropDragging}
                  contentContainerStyle={styles.stageContent}
                  horizontal
                  bounces={false}
                  showsHorizontalScrollIndicator={false}>
                  <ScrollView contentContainerStyle={styles.stageInner} bounces={false} showsVerticalScrollIndicator={false} scrollEnabled={!cropDragging}>
                    <View style={[styles.pageSurface, { width: pageWidth, aspectRatio: 0.707 }]}>
                      {currentPage ? <Image source={{ uri: currentPage.uri }} resizeMode="contain" style={styles.pageImage} /> : null}
                      {activeTool === 'crop-pdf' ? (
                        <CropOverlay
                          quad={quad}
                          mode={cropMode}
                          accent={accent}
                          onChange={setQuad}
                          onDragStateChange={setCropDragging}
                        />
                      ) : (
                        <ToolPreviewOverlay tool={activeTool} accent={accent} />
                      )}
                    </View>
                  </ScrollView>
                </ScrollView>
              )}
            </View>

            {!desktop ? (
              <PageStrip pages={pages} pageIndex={pageIndex} loading={rendering} onSelect={setPageIndex} />
            ) : null}
          </View>

          <ToolSettings
            tool={tool}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
            cropMode={cropMode}
            setCropMode={setCropMode}
            applyScope={applyScope}
            setApplyScope={setApplyScope}
            pageRange={pageRange}
            setPageRange={setPageRange}
            beforeAfter={beforeAfter}
            setBeforeAfter={setBeforeAfter}
            onAuto={() => {
              setQuad({ tl: { x: 0.09, y: 0.08 }, tr: { x: 0.9, y: 0.09 }, br: { x: 0.88, y: 0.9 }, bl: { x: 0.1, y: 0.88 } });
              setToast({ tone: 'success', text: 'Document edges detected' });
            }}
            onRemoveMargins={() => {
              setQuad({ tl: { x: 0.06, y: 0.05 }, tr: { x: 0.94, y: 0.05 }, br: { x: 0.94, y: 0.95 }, bl: { x: 0.06, y: 0.95 } });
              setToast({ tone: 'success', text: 'Margins removed in preview' });
            }}
            onPerfect={makePerfect}
            onReset={resetCrop}
            onApply={applyPreview}
            saving={saving}
            canApply={canApply}
            resultFile={resultFile}
            onDownload={downloadResult}
            onShare={shareResult}
            shareSupported={shareSupported}
            resultAction={resultAction}
          />
        </View>
      )}

      {toast ? (
        <View style={[styles.toast, { backgroundColor: toast.tone === 'success' ? theme.success : theme.danger }]}>
          <Icon name={toast.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'} size={18} color="#06120E" />
          <Txt variant="label" style={{ color: '#06120E' }}>
            {toast.text}
          </Txt>
        </View>
      ) : null}
      {!desktop ? (
        <MobileResultDock
          file={resultFile}
          onDownload={downloadResult}
          onShare={shareResult}
          shareSupported={shareSupported}
          loading={resultAction}
        />
      ) : null}
    </SafeAreaView>
  );
}

function TopToolbar({
  title,
  fileName,
  zoom,
  onBack,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onSave,
  saving,
  canSave,
}: {
  title: string;
  fileName?: string;
  zoom: number;
  onBack: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  if (!desktop) {
    return (
      <View style={[styles.topbarMobile, { backgroundColor: theme.background, borderColor: theme.border }]}>
        <View style={styles.mobileTopMain}>
          <IconButton name="arrow-left" onPress={onBack} accessibilityLabel="Back" />
          <View style={styles.titleBlock}>
            <Txt variant="h3" numberOfLines={1}>
              {title}
            </Txt>
            <Txt variant="tiny" muted numberOfLines={1}>
              {fileName ?? 'No file selected'}
            </Txt>
          </View>
          <IconButton name="content-save-outline" variant="surface" onPress={onSave} disabled={saving || !canSave} accessibilityLabel="Save or export" />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileToolbarContent}>
          <IconButton name="undo" variant="surface" onPress={onUndo} accessibilityLabel="Undo" />
          <IconButton name="redo" variant="surface" onPress={onRedo} accessibilityLabel="Redo" />
          <IconButton name="magnify-minus-outline" variant="surface" onPress={onZoomOut} accessibilityLabel="Zoom out" />
          <Pressable onPress={onFit} style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]} accessibilityRole="button">
            <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
          </Pressable>
          <IconButton name="magnify-plus-outline" variant="surface" onPress={onZoomIn} accessibilityLabel="Zoom in" />
          <Button title="Export" icon="export-variant" size="sm" onPress={onSave} loading={saving} disabled={!canSave} />
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={[styles.topbar, { backgroundColor: theme.background, borderColor: theme.border }]}>
      <IconButton name="arrow-left" onPress={onBack} accessibilityLabel="Back" />
      <View style={styles.titleBlock}>
        <Txt variant="h3" numberOfLines={1}>
          {title}
        </Txt>
        <Txt variant="tiny" muted numberOfLines={1}>
          {fileName ?? 'No file selected'}
        </Txt>
      </View>
      <View style={styles.toolbarGroup}>
        <IconButton name="undo" variant="surface" onPress={onUndo} accessibilityLabel="Undo" />
        <IconButton name="redo" variant="surface" onPress={onRedo} accessibilityLabel="Redo" />
      </View>
      <View style={styles.zoomGroup}>
        <IconButton name="magnify-minus-outline" variant="surface" onPress={onZoomOut} accessibilityLabel="Zoom out" />
        <Pressable onPress={onFit} style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]} accessibilityRole="button">
          <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
        </Pressable>
        <IconButton name="magnify-plus-outline" variant="surface" onPress={onZoomIn} accessibilityLabel="Zoom in" />
      </View>
      <Button title="Save / Export" icon="content-save-outline" size="sm" onPress={onSave} loading={saving} disabled={!canSave} />
    </View>
  );
}

function PageSidebar({ pages, pageIndex, loading, onSelect }: { pages: PreviewPage[]; pageIndex: number; loading: boolean; onSelect: (index: number) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.sidebar, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <Txt variant="label">Pages</Txt>
      <ScrollView contentContainerStyle={styles.sidebarScroll} showsVerticalScrollIndicator={false}>
        {loading && !pages.length
          ? [0, 1, 2, 3].map((i) => <PageSkeleton key={i} />)
          : pages.map((page) => (
              <Pressable
                key={page.index}
                onPress={() => onSelect(page.index)}
                style={[
                  styles.sideThumb,
                  {
                    borderColor: page.index === pageIndex ? theme.primary : theme.border,
                    backgroundColor: page.index === pageIndex ? theme.primaryMuted : theme.backgroundElement,
                  },
                ]}>
                <Image source={{ uri: page.uri }} resizeMode="cover" style={styles.sideThumbImage} />
                <Txt variant="tiny">Page {page.index + 1}</Txt>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

function PageStrip({ pages, pageIndex, loading, onSelect }: { pages: PreviewPage[]; pageIndex: number; loading: boolean; onSelect: (index: number) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.mobileStrip, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mobileStripContent}>
        {loading && !pages.length
          ? [0, 1, 2].map((i) => <PageSkeleton key={i} compact />)
          : pages.map((page) => (
              <Pressable
                key={page.index}
                onPress={() => onSelect(page.index)}
                style={[
                  styles.stripThumb,
                  {
                    borderColor: page.index === pageIndex ? theme.primary : theme.border,
                    backgroundColor: page.index === pageIndex ? theme.primaryMuted : theme.backgroundElement,
                  },
                ]}>
                <Image source={{ uri: page.uri }} resizeMode="cover" style={styles.stripThumbImage} />
                <Txt variant="tiny">{page.index + 1}</Txt>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

function PageSkeleton({ compact }: { compact?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[compact ? styles.stripThumb : styles.sideThumb, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <View style={[compact ? styles.stripThumbImage : styles.sideThumbImage, { backgroundColor: theme.skeleton, alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={theme.primary} />
      </View>
    </View>
  );
}

function CropOverlay({
  quad,
  mode,
  accent,
  onChange,
  onDragStateChange,
}: {
  quad: CropQuad;
  mode: CropMode;
  accent: string;
  onChange: (quad: CropQuad) => void;
  onDragStateChange?: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [dragging, setDragging] = useState<{ target: CropTarget; x: number; y: number } | null>(null);
  const drag = useRef<{ target: CropTarget; start: CropQuad; startX: number; startY: number } | null>(null);
  const overlayRef = useRef<unknown>(null);

  const toPx = (p: CropPoint) => ({ x: p.x * layout.width, y: p.y * layout.height });
  const px = {
    tl: toPx(quad.tl),
    tr: toPx(quad.tr),
    br: toPx(quad.br),
    bl: toPx(quad.bl),
  };
  const mids = {
    top: pointAt(px.tl, px.tr, 0.5),
    right: pointAt(px.tr, px.br, 0.5),
    bottom: pointAt(px.bl, px.br, 0.5),
    left: pointAt(px.tl, px.bl, 0.5),
  };

  const hitTest = (x: number, y: number): CropTarget => {
    const handles: [CropTarget, CropPoint][] = [
      ['tl', px.tl],
      ['tr', px.tr],
      ['br', px.br],
      ['bl', px.bl],
      ['top', mids.top],
      ['right', mids.right],
      ['bottom', mids.bottom],
      ['left', mids.left],
    ];
    for (const [key, p] of handles) {
      if (Math.hypot(p.x - x, p.y - y) < 28) return key;
    }
    const minX = Math.min(px.tl.x, px.tr.x, px.br.x, px.bl.x);
    const maxX = Math.max(px.tl.x, px.tr.x, px.br.x, px.bl.x);
    const minY = Math.min(px.tl.y, px.tr.y, px.br.y, px.bl.y);
    const maxY = Math.max(px.tl.y, px.tr.y, px.br.y, px.bl.y);
    return x >= minX && x <= maxX && y >= minY && y <= maxY ? 'move' : 'move';
  };

  const beginDrag = (x: number, y: number) => {
    const target = hitTest(x, y);
    drag.current = { target, start: cloneQuad(quad), startX: x, startY: y };
    setDragging({ target, x, y });
    onDragStateChange?.(true);
  };

  const updateDrag = (x: number, y: number) => {
    if (!drag.current) return;
    const dx = (x - drag.current.startX) / layout.width;
    const dy = (y - drag.current.startY) / layout.height;
    const { target, start } = drag.current;
    let next = cloneQuad(start);
    if (target === 'move') {
      next = moveQuad(start, dx, dy);
    } else if (target === 'top' || target === 'bottom') {
      const keys: CropPointKey[] = target === 'top' ? ['tl', 'tr'] : ['bl', 'br'];
      keys.forEach((key) => {
        next[key].y = clamp01(start[key].y + dy);
      });
    } else if (target === 'left' || target === 'right') {
      const keys: CropPointKey[] = target === 'left' ? ['tl', 'bl'] : ['tr', 'br'];
      keys.forEach((key) => {
        next[key].x = clamp01(start[key].x + dx);
      });
    } else {
      next[target] = { x: clamp01(start[target].x + dx), y: clamp01(start[target].y + dy) };
      if (mode === 'rectangle') next = rectFromQuad(next);
    }
    onChange(next);
    setDragging({ target, x, y });
  };

  const endDrag = () => {
    drag.current = null;
    setDragging(null);
    onDragStateChange?.(false);
  };

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = overlayRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const pointerHandlers =
    Platform.OS === 'web'
      ? ({
          onPointerDown: (evt: unknown) => {
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              currentTarget?: { setPointerCapture?: (id: number) => void };
              nativeEvent?: { clientX: number; clientY: number; pointerId?: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            if (native.pointerId !== undefined) e.currentTarget?.setPointerCapture?.(native.pointerId);
            const point = localPointFromClient(native.clientX, native.clientY);
            if (point) beginDrag(point.x, point.y);
          },
          onPointerMove: (evt: unknown) => {
            if (!drag.current) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            const point = localPointFromClient(native.clientX, native.clientY);
            if (point) updateDrag(point.x, point.y);
          },
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          onLostPointerCapture: endDrag,
        } as Record<string, unknown>)
      : {};

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          if (Platform.OS === 'web') return;
          beginDrag(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        },
        onPanResponderMove: (evt, gesture) => {
          if (Platform.OS === 'web' || !drag.current) return;
          updateDrag(drag.current.startX + gesture.dx, drag.current.startY + gesture.dy);
        },
        onPanResponderRelease: endDrag,
        onPanResponderTerminate: endDrag,
      }),
    [beginDrag, endDrag, updateDrag],
  );

  const path = `M0 0H${layout.width}V${layout.height}H0Z M${px.tl.x} ${px.tl.y} L${px.tr.x} ${px.tr.y} L${px.br.x} ${px.br.y} L${px.bl.x} ${px.bl.y} Z`;
  const polyPoints = `${px.tl.x},${px.tl.y} ${px.tr.x},${px.tr.y} ${px.br.x},${px.br.y} ${px.bl.x},${px.bl.y}`;
  const gridLines = [1 / 3, 2 / 3].flatMap((t) => {
    const top = pointAt(px.tl, px.tr, t);
    const bottom = pointAt(px.bl, px.br, t);
    const left = pointAt(px.tl, px.bl, t);
    const right = pointAt(px.tr, px.br, t);
    return [
      { a: top, b: bottom },
      { a: left, b: right },
    ];
  });
  const center = {
    x: (px.tl.x + px.tr.x + px.br.x + px.bl.x) / 4,
    y: (px.tl.y + px.tr.y + px.br.y + px.bl.y) / 4,
  };

  return (
    <View
      testID="crop-overlay"
      ref={overlayRef as never}
      style={[StyleSheet.absoluteFill, WEB_GESTURE_STYLE]}
      onLayout={(e: LayoutChangeEvent) => setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      {...pan.panHandlers}
      {...pointerHandlers}>
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Path d={path} fill="rgba(3,7,12,0.62)" fillRule="evenodd" />
        {gridLines.map((line, index) => (
          <Line key={index} x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke={withAlpha(accent, 0.52)} strokeWidth={1.2} strokeDasharray="7 6" />
        ))}
        <Polygon points={polyPoints} fill="transparent" stroke={accent} strokeWidth={3.5} />
        <Circle cx={center.x} cy={center.y} r={20} fill={withAlpha(accent, 0.22)} stroke={accent} strokeWidth={1.5} />
      </Svg>
      {(['tl', 'tr', 'br', 'bl'] as CropPointKey[]).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[styles.cornerHandle, { left: px[key].x - 16, top: px[key].y - 16, borderColor: accent, backgroundColor: theme.background }]}
        />
      ))}
      {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[styles.edgeHandle, { left: mids[key].x - 12, top: mids[key].y - 12, backgroundColor: accent }]}
        />
      ))}
      <View pointerEvents="none" style={[styles.dragHint, { left: center.x - 64, top: center.y + 28, backgroundColor: withAlpha(theme.background, 0.88), borderColor: withAlpha(accent, 0.7) }]}>
        <Icon name="cursor-move" size={14} color={accent} />
        <Txt variant="tiny">Drag crop</Txt>
      </View>
      {dragging ? (
        <View pointerEvents="none" style={[styles.magnifier, { left: Math.min(layout.width - 116, dragging.x + 18), top: Math.max(8, dragging.y - 74), borderColor: accent, backgroundColor: theme.backgroundElevated }]}>
          <Icon name="magnify" size={16} color={accent} />
          <Txt variant="tiny">{dragging.target}</Txt>
        </View>
      ) : null}
    </View>
  );
}

function ToolPreviewOverlay({ tool, accent }: { tool: EditorToolId; accent: string }) {
  const theme = useTheme();
  if (tool === 'add-text') {
    return (
      <View style={[styles.textObject, { borderColor: accent, backgroundColor: withAlpha(theme.background, 0.76) }]}>
        <Txt variant="label">Editable text</Txt>
        <View style={[styles.floatingToolbar, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
          {['format-bold', 'format-italic', 'format-underline', 'format-color-text'].map((icon) => (
            <Icon key={icon} name={icon} size={16} color={theme.text} />
          ))}
        </View>
      </View>
    );
  }
  if (tool === 'redact') {
    return <View style={[styles.redactBox, { borderColor: accent }]} />;
  }
  if (tool === 'highlight') {
    return <View style={[styles.highlightBox, { backgroundColor: withAlpha(Accents.yellow, 0.42), borderColor: Accents.yellow }]} />;
  }
  if (tool === 'add-signature') {
    return (
      <View style={[styles.signaturePreview, { borderColor: accent }]}>
        <Txt variant="h2" style={{ color: accent, fontStyle: 'italic' }}>
          Signature
        </Txt>
      </View>
    );
  }
  if (tool === 'add-stamp') {
    return (
      <View style={[styles.stampPreview, { borderColor: accent }]}>
        <Txt variant="h2" style={{ color: accent }}>
          APPROVED
        </Txt>
      </View>
    );
  }
  return null;
}

function ToolSettings({
  tool,
  activeTool,
  setActiveTool,
  cropMode,
  setCropMode,
  applyScope,
  setApplyScope,
  pageRange,
  setPageRange,
  beforeAfter,
  setBeforeAfter,
  onAuto,
  onRemoveMargins,
  onPerfect,
  onReset,
  onApply,
  saving,
  canApply,
  resultFile,
  onDownload,
  onShare,
  shareSupported,
  resultAction,
}: {
  tool: ToolMeta;
  activeTool: EditorToolId;
  setActiveTool: (tool: EditorToolId) => void;
  cropMode: CropMode;
  setCropMode: (mode: CropMode) => void;
  applyScope: ApplyScope;
  setApplyScope: (scope: ApplyScope) => void;
  pageRange: string;
  setPageRange: (value: string) => void;
  beforeAfter: 'before' | 'after';
  setBeforeAfter: (value: 'before' | 'after') => void;
  onAuto: () => void;
  onRemoveMargins: () => void;
  onPerfect: () => void;
  onReset: () => void;
  onApply: () => void;
  saving: boolean;
  canApply: boolean;
  resultFile: FileItem | null;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  resultAction: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const accent = Accents[tool.accent];
  return (
    <View style={[desktop ? styles.settingsPanel : styles.mobileSheet, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.settingsContent,
          !desktop && resultFile ? styles.settingsContentWithResultDock : null,
        ]}>
        <View style={styles.panelHeader}>
          <View style={[styles.toolPill, { backgroundColor: withAlpha(accent, 0.16) }]}>
            <Icon name={tool.icon} size={20} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{tool.title}</Txt>
            <Txt variant="tiny" muted>{tool.subtitle}</Txt>
          </View>
        </View>

        <Labeled label="Tool">
          <View style={[styles.toolScrollFrame, { borderColor: theme.border, backgroundColor: theme.background }]}>
            <ScrollView
              horizontal
              nestedScrollEnabled
              persistentScrollbar
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="handled"
              style={styles.toolScroll}
              contentContainerStyle={styles.toolRail}>
              {TOOL_IDS.map((id) => {
                const meta = EDITOR_TOOLS[id];
                const active = id === activeTool;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setActiveTool(id)}
                    style={[styles.toolChip, { backgroundColor: active ? withAlpha(Accents[meta.accent], 0.22) : theme.backgroundElement, borderColor: active ? Accents[meta.accent] : theme.border }]}>
                    <Icon name={meta.icon} size={16} color={active ? Accents[meta.accent] : theme.textSecondary} />
                    <Txt variant="tiny" style={{ color: active ? Accents[meta.accent] : theme.textSecondary }}>
                      {meta.title}
                    </Txt>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View pointerEvents="none" style={[styles.toolScrollCue, { backgroundColor: theme.background }]}>
              <Icon name="chevron-right" size={18} color={theme.textMuted} />
            </View>
          </View>
        </Labeled>

        {activeTool === 'crop-pdf' ? (
          <>
            <Labeled label="Crop mode">
              <Segmented options={CROP_MODE_OPTIONS} value={cropMode} onChange={setCropMode} />
            </Labeled>
            <ActionWrap>
              <ActionButton icon="auto-fix" label="Auto Detect" onPress={onAuto} accent={accent} />
              <ActionButton icon="page-layout-body" label="Remove Margins" onPress={onRemoveMargins} accent={accent} />
              <ActionButton icon="vector-square" label="Make Perfect Rectangle" onPress={onPerfect} accent={accent} />
              <ActionButton icon="rotate-right" label="Rotate" accent={accent} />
              <ActionButton icon="backup-restore" label="Reset" onPress={onReset} />
            </ActionWrap>
            <Labeled label="Compare">
              <Segmented
                options={[
                  { label: 'Before', value: 'before' },
                  { label: 'After', value: 'after' },
                ]}
                value={beforeAfter}
                onChange={setBeforeAfter}
              />
            </Labeled>
            <Labeled label="Apply to">
              <Segmented options={APPLY_OPTIONS} value={applyScope} onChange={setApplyScope} />
            </Labeled>
            {applyScope === 'range' ? <TextField label="Page range" value={pageRange} onChangeText={setPageRange} placeholder="1-3, 7" /> : null}
            <Button title="Apply Crop" icon="check" onPress={onApply} loading={saving} disabled={!canApply} full />
            <ResultActions
              file={resultFile}
              onDownload={onDownload}
              onShare={onShare}
              shareSupported={shareSupported}
              loading={resultAction}
            />
          </>
        ) : (
          <>
            <ToolSpecificPanel tool={activeTool} accent={accent} onApply={onApply} saving={saving} canApply={canApply} />
            <ResultActions
              file={resultFile}
              onDownload={onDownload}
              onShare={onShare}
              shareSupported={shareSupported}
              loading={resultAction}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ResultActions({
  file,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View style={[styles.resultPanel, { backgroundColor: theme.primaryMuted, borderColor: withAlpha(theme.primary, 0.48) }]}>
      <View style={styles.resultHeader}>
        <View style={[styles.resultIcon, { backgroundColor: theme.primary }]}>
          <Icon name="check" size={16} color={theme.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label" numberOfLines={1}>
            Result ready
          </Txt>
          <Txt variant="tiny" muted numberOfLines={1}>
            {file.name}
          </Txt>
        </View>
      </View>
      <View style={styles.resultActions}>
        <Button
          title="Download"
          icon="download-outline"
          variant="secondary"
          onPress={onDownload}
          loading={loading === 'download'}
          disabled={loading === 'share'}
          style={styles.mobileResultButton}
          full
        />
        <Button
          title="Share"
          icon="share-variant"
          variant="secondary"
          onPress={onShare}
          loading={loading === 'share'}
          disabled={!shareSupported || loading === 'download'}
          style={styles.mobileResultButton}
          full
        />
      </View>
    </View>
  );
}

function MobileResultDock({
  file,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View style={[styles.mobileResultDock, { backgroundColor: theme.backgroundElevated, borderColor: withAlpha(theme.primary, 0.55) }]}>
      <View style={styles.mobileResultTitle}>
        <View style={[styles.resultIcon, { backgroundColor: theme.primary }]}>
          <Icon name="check" size={16} color={theme.primaryText} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt variant="label" numberOfLines={1}>
            Result ready
          </Txt>
          <Txt variant="tiny" muted numberOfLines={1}>
            {file.name}
          </Txt>
        </View>
      </View>
      <View style={styles.mobileResultButtons}>
        <Button
          title="Download"
          icon="download-outline"
          variant="secondary"
          size="sm"
          onPress={onDownload}
          loading={loading === 'download'}
          disabled={loading === 'share'}
          full
        />
        <Button
          title="Share"
          icon="share-variant"
          variant="secondary"
          size="sm"
          onPress={onShare}
          loading={loading === 'share'}
          disabled={!shareSupported || loading === 'download'}
          full
        />
      </View>
    </View>
  );
}

function ToolSpecificPanel({
  tool,
  accent,
  onApply,
  saving,
  canApply,
}: {
  tool: EditorToolId;
  accent: string;
  onApply: () => void;
  saving: boolean;
  canApply: boolean;
}) {
  if (tool === 'add-page-numbers') {
    return (
      <>
        <Labeled label="Position">
          <PositionGrid active="bottom-center" accent={accent} />
        </Labeled>
        <TextField label="Format" value="Page {n} of {total}" onChangeText={() => undefined} />
        <View style={styles.twoCols}>
          <TextField label="Start" value="1" onChangeText={() => undefined} keyboardType="number-pad" />
          <TextField label="Font size" value="12" onChangeText={() => undefined} keyboardType="number-pad" />
        </View>
        <ColorSwatches colors={['#EAF0F6', '#2BD9A8', '#3B82F6', '#FF5C5C']} active="#EAF0F6" />
        <Button title="Preview Page Numbers" icon="format-list-numbered" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'add-watermark') {
    return (
      <>
        <Segmented
          options={[
            { label: 'Text', value: 'text' },
            { label: 'Image', value: 'image' },
          ]}
          value="text"
          onChange={() => undefined}
        />
        <TextField label="Watermark" value="CONFIDENTIAL" onChangeText={() => undefined} />
        <SliderControl label="Opacity" value="34%" accent={accent} />
        <SliderControl label="Rotation" value="45 deg" accent={accent} />
        <Labeled label="Position">
          <PositionGrid active="center" accent={accent} />
        </Labeled>
        <ActionWrap>
          <ActionButton icon="grid" label="Tile" accent={accent} />
          <ActionButton icon="layers-outline" label="Behind text" />
        </ActionWrap>
        <Button title="Preview Watermark" icon="watermark" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'flatten') {
    return (
      <>
        <WarningBox title="Flatten preview" text="Flattened objects may no longer be editable after export." />
        {['Annotations', 'Forms', 'Signatures', 'Drawings', 'Stamps', 'Editable layers'].map((item, index) => (
          <CheckRow key={item} label={item} checked={index < 4} />
        ))}
        <Button title="Preview Flattened PDF" icon="layers-outline" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'add-text') {
    return (
      <>
        <TextField label="Text" value="Editable text" onChangeText={() => undefined} />
        <ActionWrap>
          {['format-bold', 'format-italic', 'format-underline', 'format-align-center'].map((icon) => (
            <ActionButton key={icon} icon={icon} label={icon.replace('format-', '')} accent={accent} />
          ))}
        </ActionWrap>
        <SliderControl label="Font size" value="18 pt" accent={accent} />
        <ColorSwatches colors={['#EAF0F6', '#111827', '#2BD9A8', '#FB7185']} active="#2BD9A8" />
        <Button title="Place Text Box" icon="format-text" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'add-signature') {
    return (
      <>
        <Segmented
          options={[
            { label: 'Draw', value: 'draw' },
            { label: 'Type', value: 'type' },
            { label: 'Upload', value: 'upload' },
          ]}
          value="draw"
          onChange={() => undefined}
        />
        <View style={styles.signaturePad}>
          <Txt variant="h2" style={{ color: accent, fontStyle: 'italic' }}>Your signature</Txt>
        </View>
        <SliderControl label="Opacity" value="100%" accent={accent} />
        <Button title="Place Signature" icon="draw" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'doodle') {
    return (
      <>
        <ActionWrap>
          {['pencil-outline', 'marker', 'eraser', 'vector-line', 'arrow-top-right'].map((icon) => (
            <ActionButton key={icon} icon={icon} label={icon.split('-')[0]} accent={accent} />
          ))}
        </ActionWrap>
        <ColorSwatches colors={['#EAF0F6', '#2BD9A8', '#F7C948', '#FB7185', '#3B82F6']} active="#FB7185" />
        <SliderControl label="Stroke size" value="6 px" accent={accent} />
        <Button title="Apply Drawing Layer" icon="pencil-outline" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'highlight') {
    return (
      <>
        <ColorSwatches colors={['#F7C948', '#2BD9A8', '#38BDF8', '#FB7185']} active="#F7C948" />
        <SliderControl label="Opacity" value="42%" accent={accent} />
        <ActionWrap>
          <ActionButton icon="format-underline" label="Underline" />
          <ActionButton icon="format-strikethrough" label="Strike" />
          <ActionButton icon="gesture" label="Squiggle" />
        </ActionWrap>
        <Button title="Apply Highlight" icon="marker" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'add-stamp') {
    return (
      <>
        <View style={styles.stampGallery}>
          {['Approved', 'Draft', 'Final', 'Paid', 'Reviewed', 'Rejected'].map((stamp) => (
            <View key={stamp} style={[styles.stampChip, { borderColor: accent }]}>
              <Txt variant="tiny" style={{ color: accent }}>{stamp}</Txt>
            </View>
          ))}
        </View>
        <TextField label="Custom stamp" value="APPROVED" onChangeText={() => undefined} />
        <SliderControl label="Rotation" value="-12 deg" accent={accent} />
        <Button title="Place Stamp" icon="stamper" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'annotate') {
    return (
      <>
        {['Review missing date', 'Confirm signature', 'Resolve price note'].map((note, index) => (
          <View key={note} style={styles.commentRow}>
            <Txt variant="label">Comment {index + 1}</Txt>
            <Txt variant="tiny" muted>{note}</Txt>
          </View>
        ))}
        <ActionWrap>
          <ActionButton icon="comment-plus-outline" label="Note" accent={accent} />
          <ActionButton icon="arrow-top-right" label="Callout" />
          <ActionButton icon="shape-outline" label="Shape" />
        </ActionWrap>
        <Button title="Apply Annotations" icon="comment-edit-outline" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  if (tool === 'redact') {
    return (
      <>
        <TextField label="Search text" placeholder="Email, phone, ID, name..." onChangeText={() => undefined} />
        <ActionWrap>
          <ActionButton icon="email-outline" label="Emails" accent={accent} />
          <ActionButton icon="phone-outline" label="Phones" />
          <ActionButton icon="card-account-details-outline" label="IDs" />
          <ActionButton icon="selection-drag" label="Manual box" />
        </ActionWrap>
        <WarningBox title="Permanent redaction" text="Preview every redaction before export." />
        <Button title="Preview Redactions" icon="marker-cancel" onPress={onApply} loading={saving} disabled={!canApply} full />
      </>
    );
  }
  return (
    <>
      {['Name', 'Date', 'Checkbox', 'Signature'].map((field, index) => (
        <View key={field} style={styles.commentRow}>
          <Txt variant="label">Field {index + 1}</Txt>
          <Txt variant="tiny" muted>{field}</Txt>
        </View>
      ))}
      <ActionWrap>
        <ActionButton icon="form-textbox" label="Text field" accent={accent} />
        <ActionButton icon="checkbox-marked-outline" label="Checkbox" />
        <ActionButton icon="draw" label="Signature" />
      </ActionWrap>
      <Button title="Preview Filled Form" icon="form-select" onPress={onApply} loading={saving} disabled={!canApply} full />
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.labeled}>
      <Txt variant="label" muted>{label}</Txt>
      {children}
    </View>
  );
}

function ActionWrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.actionWrap}>{children}</View>;
}

function ActionButton({ icon, label, onPress, accent }: { icon: string; label: string; onPress?: () => void; accent?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: accent ? withAlpha(accent, pressed ? 0.22 : 0.14) : theme.backgroundElement,
          borderColor: accent ?? theme.border,
          opacity: pressed ? 0.86 : 1,
        },
      ]}>
      <Icon name={icon} size={17} color={accent ?? theme.textSecondary} />
      <Txt variant="tiny" center style={styles.actionButtonLabel}>
        {label}
      </Txt>
    </Pressable>
  );
}

function SliderControl({ label, value, accent }: { label: string; value: string; accent: string }) {
  const theme = useTheme();
  return (
    <View style={styles.labeled}>
      <View style={styles.rowBetween}>
        <Txt variant="label" muted>{label}</Txt>
        <Txt variant="tiny">{value}</Txt>
      </View>
      <View style={[styles.sliderTrack, { backgroundColor: theme.backgroundElement }]}>
        <View style={[styles.sliderFill, { backgroundColor: accent, width: '58%' }]} />
        <View style={[styles.sliderKnob, { backgroundColor: accent, left: '56%' }]} />
      </View>
    </View>
  );
}

function ColorSwatches({ colors, active }: { colors: string[]; active: string }) {
  const theme = useTheme();
  return (
    <View style={styles.swatchRow}>
      {colors.map((color) => (
        <View key={color} style={[styles.swatch, { backgroundColor: color, borderColor: color === active ? theme.primary : theme.borderStrong }]} />
      ))}
    </View>
  );
}

function PositionGrid({ active, accent }: { active: string; accent: string }) {
  const theme = useTheme();
  const cells = ['top-left', 'top-center', 'top-right', 'middle-left', 'center', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'];
  return (
    <View style={[styles.positionGrid, { borderColor: theme.border }]}>
      {cells.map((cell) => (
        <View key={cell} style={[styles.positionCell, { backgroundColor: cell === active ? withAlpha(accent, 0.28) : theme.backgroundElement, borderColor: theme.border }]}>
          {cell === active ? <View style={[styles.positionDot, { backgroundColor: accent }]} /> : null}
        </View>
      ))}
    </View>
  );
}

function CheckRow({ label, checked }: { label: string; checked: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.checkRow, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <Icon name={checked ? 'checkbox-marked-circle-outline' : 'checkbox-blank-circle-outline'} size={20} color={checked ? theme.primary : theme.textMuted} />
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

function WarningBox({ title, text }: { title: string; text: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.warningBox, { backgroundColor: theme.warningMuted, borderColor: withAlpha(theme.warning, 0.45) }]}>
      <Icon name="alert-outline" size={18} color={theme.warning} />
      <View style={{ flex: 1 }}>
        <Txt variant="label" style={{ color: theme.warning }}>{title}</Txt>
        <Txt variant="tiny" style={{ color: theme.warning }}>{text}</Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topbar: { minHeight: 64, borderBottomWidth: 1, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  topbarMobile: { borderBottomWidth: 1, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  mobileTopMain: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  mobileToolbarContent: { gap: Spacing.sm, paddingHorizontal: Spacing.xs, paddingRight: Spacing.lg },
  titleBlock: { flex: 1, minWidth: 0 },
  toolbarGroup: { flexDirection: 'row', gap: 6 },
  zoomGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoomPill: { minWidth: 58, height: 36, borderRadius: Radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.sm },
  pickShell: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  pickPanel: { width: '100%', maxWidth: 620, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.xl, gap: Spacing.md },
  bigIcon: { width: 68, height: 68, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  pickSubtitle: { maxWidth: 420, alignSelf: 'center' },
  editorBody: { flex: 1, minHeight: 0 },
  editorBodyDesktop: { flexDirection: 'row' },
  editorBodyMobile: { flexDirection: 'column' },
  sidebar: { width: 164, borderRightWidth: 1, padding: Spacing.md, gap: Spacing.md },
  sidebarScroll: { gap: Spacing.md, paddingBottom: Spacing.xl },
  sideThumb: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm, gap: Spacing.xs },
  sideThumbImage: { width: '100%', aspectRatio: 0.72, borderRadius: Radius.sm, backgroundColor: '#fff' },
  canvasColumn: { flex: 1, minWidth: 0 },
  canvasHeader: { minHeight: 62, borderBottomWidth: 1, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  canvasTitle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  toolPill: { width: 38, height: 38, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  canvasNav: { flexDirection: 'row', gap: Spacing.xs },
  stage: { flex: 1, minHeight: 0 },
  stageScroll: { flex: 1 },
  stageContent: { minWidth: '100%', flexGrow: 1 },
  stageInner: { minHeight: '100%', minWidth: '100%', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  pageSurface: { backgroundColor: '#fff', borderRadius: Radius.sm, overflow: 'hidden' },
  pageImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%' },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  settingsPanel: { width: 360, borderLeftWidth: 1 },
  mobileSheet: { maxHeight: 330, borderTopWidth: 1, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl },
  settingsContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  settingsContentWithResultDock: { paddingBottom: 156 },
  panelHeader: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  toolScrollFrame: { position: 'relative', borderWidth: 1, borderRadius: Radius.xl, overflow: 'hidden', paddingVertical: 4 },
  toolScroll: { maxHeight: 54 },
  toolRail: { gap: Spacing.sm, paddingRight: Spacing.lg },
  toolScrollCue: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 28, alignItems: 'center', justifyContent: 'center' },
  toolChip: { height: 38, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: 6 },
  labeled: { gap: Spacing.xs },
  actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  actionButton: { minHeight: 54, minWidth: 150, flex: 1, borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionButtonLabel: { flexShrink: 1 },
  mobileStrip: { borderTopWidth: 1, paddingVertical: Spacing.sm },
  mobileStripContent: { gap: Spacing.sm, paddingHorizontal: Spacing.md },
  stripThumb: { width: 70, borderWidth: 1, borderRadius: Radius.md, padding: 5, gap: 3, alignItems: 'center' },
  stripThumbImage: { width: '100%', aspectRatio: 0.72, borderRadius: Radius.sm, backgroundColor: '#fff' },
  cornerHandle: { position: 'absolute', width: 32, height: 32, borderRadius: Radius.sm, borderWidth: 4 },
  edgeHandle: { position: 'absolute', width: 24, height: 24, borderRadius: Radius.pill },
  dragHint: { position: 'absolute', height: 30, borderRadius: Radius.pill, borderWidth: 1, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: 6 },
  magnifier: { position: 'absolute', width: 96, height: 54, borderRadius: Radius.lg, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  textObject: { position: 'absolute', left: '19%', top: '30%', width: '44%', minHeight: 74, borderWidth: 2, borderRadius: Radius.sm, padding: Spacing.sm },
  floatingToolbar: { position: 'absolute', top: -42, left: 0, height: 34, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  redactBox: { position: 'absolute', left: '22%', top: '42%', width: '48%', height: 48, backgroundColor: '#050505', borderWidth: 2 },
  highlightBox: { position: 'absolute', left: '18%', top: '36%', width: '56%', height: 42, borderWidth: 1.5, borderRadius: Radius.xs },
  signaturePreview: { position: 'absolute', left: '42%', top: '70%', width: '34%', height: 82, borderWidth: 1.5, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  stampPreview: { position: 'absolute', left: '24%', top: '55%', width: '48%', height: 92, borderWidth: 4, borderRadius: Radius.sm, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-12deg' }] },
  toast: { position: 'absolute', right: Spacing.lg, bottom: Spacing.lg, minHeight: 46, borderRadius: Radius.pill, paddingHorizontal: Spacing.lg, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderTrack: { height: 8, borderRadius: Radius.pill, overflow: 'hidden' },
  sliderFill: { height: '100%', borderRadius: Radius.pill },
  sliderKnob: { position: 'absolute', top: -5, width: 18, height: 18, borderRadius: Radius.pill },
  swatchRow: { flexDirection: 'row', gap: Spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: Radius.pill, borderWidth: 3 },
  twoCols: { flexDirection: 'row', gap: Spacing.sm },
  positionGrid: { borderWidth: 1, borderRadius: Radius.md, overflow: 'hidden', flexDirection: 'row', flexWrap: 'wrap' },
  positionCell: { width: '33.333%', aspectRatio: 2.1, borderWidth: 0.5, alignItems: 'center', justifyContent: 'center' },
  positionDot: { width: 10, height: 10, borderRadius: Radius.pill },
  checkRow: { minHeight: 46, borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  warningBox: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm },
  resultPanel: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultIcon: { width: 28, height: 28, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  resultActions: { gap: Spacing.sm },
  mobileResultDock: { position: 'absolute', left: Spacing.md, right: Spacing.md, bottom: Spacing.md, borderWidth: 1, borderRadius: Radius.xl, padding: Spacing.md, gap: Spacing.sm },
  mobileResultTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mobileResultButtons: { flexDirection: 'row', gap: Spacing.sm },
  mobileResultButton: { flex: 1 },
  signaturePad: { height: 118, borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  stampGallery: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stampChip: { borderWidth: 2, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, transform: [{ rotate: '-4deg' }] },
  commentRow: { borderRadius: Radius.md, padding: Spacing.md, backgroundColor: 'rgba(255,255,255,0.045)', gap: 2 },
});
