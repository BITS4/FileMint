import JSZip from 'jszip';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Path, Polygon } from 'react-native-svg';

import { ToolOutcome } from '@/components/tools/ToolOutcome';
import {
  AppHeader,
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  ProgressBar,
  Screen,
  Segmented,
  type SegmentedOption,
  TextField,
  Txt,
} from '@/components/ui';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { useRunner } from '@/hooks/use-runner';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import { withAlpha } from '@/lib/color';
import { baseName, extFromName, formatBytes, kindMeta, withExt } from '@/lib/format';
import { prepareImageForPdf, type ImageEditOptions } from '@/lib/image';
import {
  cropPdfEdges,
  csvRowsToPdf,
  extractPages,
  imagesToPdf,
  mergePdfs,
  optimizePdf,
  rotatePages,
  textToPdf,
  type CropEdges,
  type Orientation,
  type PageSizeKey,
} from '@/lib/pdf';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import * as storage from '@/lib/storage';
import { decodeUtf8, parseCsvRows } from '@/lib/text';
import { uid } from '@/lib/uid';
import { useLibrary } from '@/store/useLibrary';
import type { ConversionReport, FileItem, FileKind } from '@/types';

type StudioProfile = 'all' | 'image' | 'word' | 'ppt' | 'excel' | 'csv' | 'text' | 'batch';
type FilterId =
  | 'original'
  | 'auto-enhance'
  | 'enhance'
  | 'enhance-2'
  | 'magic-color'
  | 'auto-color'
  | 'light-text'
  | 'bw'
  | 'grayscale'
  | 'whiteboard'
  | 'high-contrast'
  | 'clean-bg'
  | 'remove-shadows'
  | 'photo'
  | 'darker'
  | 'brighter';
type Quality = 'low' | 'medium' | 'high' | 'original';
type MarginKey = 'none' | 'small' | 'medium' | 'large';
type ExportMode = 'merge' | 'separate';
type PageSizeChoice = 'auto' | PageSizeKey;
type OrientationChoice = 'auto' | Orientation;
type Rotation = 0 | 90 | 180 | 270;
type CropPointKey = 'tl' | 'tr' | 'br' | 'bl';
type CropPoint = { x: number; y: number };
type CropQuad = Record<CropPointKey, CropPoint>;

interface SourceDoc {
  id: string;
  file: FileItem;
  pdfBytes: Uint8Array;
  pageCount: number;
  report?: ConversionReport;
}

interface StudioPage {
  id: string;
  sourceId: string;
  fileId: string;
  fileName: string;
  fileKind: FileKind;
  sourceIndex: number;
  previewBytes: Uint8Array;
  previewUri: string;
  previewWidth: number;
  previewHeight: number;
  included: boolean;
  rotation: Rotation;
  filter: FilterId;
  crop: Required<Pick<CropEdges, 'top' | 'right' | 'bottom' | 'left'>>;
  quad: CropQuad;
}

const SUPPORTED_EXTS = new Set([
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
  'bmp',
  'tif',
  'tiff',
  'csv',
  'txt',
  'md',
  'text',
]);

const OFFICE_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

const PAGE_SIZE_OPTIONS: SegmentedOption<PageSizeChoice>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'A4', value: 'a4' },
  { label: 'Letter', value: 'letter' },
  { label: 'Legal', value: 'legal' },
];
const ORIENTATION_OPTIONS: SegmentedOption<OrientationChoice>[] = [
  { label: 'Auto', value: 'auto', icon: 'page-layout-header' },
  { label: 'Portrait', value: 'portrait', icon: 'crop-portrait' },
  { label: 'Landscape', value: 'landscape', icon: 'crop-landscape' },
];
const MARGIN_OPTIONS: SegmentedOption<MarginKey>[] = [
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
];
const QUALITY_OPTIONS: SegmentedOption<Quality>[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Original', value: 'original' },
];
const EXPORT_OPTIONS: SegmentedOption<ExportMode>[] = [
  { label: 'One PDF', value: 'merge', icon: 'file-pdf-box' },
  { label: 'Separate', value: 'separate', icon: 'file-multiple-outline' },
];

const FILTERS: { value: FilterId; label: string; icon: string }[] = [
  { value: 'original', label: 'Original', icon: 'image-outline' },
  { value: 'auto-enhance', label: 'Auto Enhance', icon: 'auto-fix' },
  { value: 'enhance', label: 'Enhance', icon: 'contrast-circle' },
  { value: 'enhance-2', label: 'Enhance 2', icon: 'creation' },
  { value: 'magic-color', label: 'Magic Color', icon: 'palette-outline' },
  { value: 'auto-color', label: 'Auto Color', icon: 'invert-colors' },
  { value: 'light-text', label: 'Light Text', icon: 'format-color-text' },
  { value: 'bw', label: 'Black & White', icon: 'circle-slice-8' },
  { value: 'grayscale', label: 'Grayscale', icon: 'gradient-horizontal' },
  { value: 'whiteboard', label: 'Whiteboard', icon: 'presentation' },
  { value: 'high-contrast', label: 'High Contrast', icon: 'contrast-box' },
  { value: 'clean-bg', label: 'Clean Background', icon: 'eraser' },
  { value: 'remove-shadows', label: 'Remove Shadows', icon: 'weather-night' },
  { value: 'photo', label: 'Photo', icon: 'camera-image' },
  { value: 'darker', label: 'Darker', icon: 'brightness-4' },
  { value: 'brighter', label: 'Brighter', icon: 'brightness-6' },
];

const DEFAULT_QUAD: CropQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

function profileTitle(profile: StudioProfile) {
  if (profile === 'image') return 'Images to PDF';
  if (profile === 'word') return 'Word to PDF';
  if (profile === 'ppt') return 'PowerPoint to PDF';
  if (profile === 'excel') return 'Excel to PDF';
  if (profile === 'csv') return 'CSV to PDF';
  if (profile === 'text') return 'Text to PDF';
  if (profile === 'batch') return 'Batch to PDF';
  return 'Convert to PDF';
}

function pickTypes(profile: StudioProfile): string | string[] {
  if (profile === 'image') return 'image/*';
  if (profile === 'word') return OFFICE_TYPES.slice(0, 2);
  if (profile === 'ppt') return OFFICE_TYPES.slice(2, 4);
  if (profile === 'excel') return OFFICE_TYPES.slice(4, 6);
  if (profile === 'csv') return ['text/csv', 'text/comma-separated-values', 'text/plain'];
  if (profile === 'text') return ['text/plain', 'text/markdown', 'text/*'];
  return ['image/*', 'text/*', ...OFFICE_TYPES];
}

function supportsProfile(file: FileItem, profile: StudioProfile) {
  if (!SUPPORTED_EXTS.has(file.ext)) return false;
  if (profile === 'image') return file.kind === 'image';
  if (profile === 'word') return file.kind === 'word';
  if (profile === 'ppt') return file.kind === 'ppt';
  if (profile === 'excel') return file.kind === 'excel';
  if (profile === 'csv') return file.kind === 'csv' || file.ext === 'csv';
  if (profile === 'text') return file.kind === 'text' && file.ext !== 'csv';
  return file.kind === 'image' || file.kind === 'word' || file.kind === 'ppt' || file.kind === 'excel' || file.kind === 'csv' || file.kind === 'text';
}

function normalizeProfile(value: unknown): StudioProfile {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === 'image' || raw === 'word' || raw === 'ppt' || raw === 'excel' || raw === 'csv' || raw === 'text' || raw === 'batch') return raw;
  return 'all';
}

function marginPoints(margin: MarginKey) {
  if (margin === 'none') return 0;
  if (margin === 'small') return 24;
  if (margin === 'medium') return 42;
  return 64;
}

function cropIsActive(crop: StudioPage['crop']) {
  return crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0;
}

function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

function cloneQuad(quad: CropQuad = DEFAULT_QUAD): CropQuad {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function cropFromQuad(quad: CropQuad): StudioPage['crop'] {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const left = Math.min(...xs) * 100;
  const right = (1 - Math.max(...xs)) * 100;
  const top = Math.min(...ys) * 100;
  const bottom = (1 - Math.max(...ys)) * 100;
  return { top, right, bottom, left };
}

function quadFromCrop(crop: StudioPage['crop']): CropQuad {
  const left = clamp01(crop.left / 100);
  const right = clamp01(1 - crop.right / 100);
  const top = clamp01(crop.top / 100);
  const bottom = clamp01(1 - crop.bottom / 100);
  return {
    tl: { x: left, y: top },
    tr: { x: right, y: top },
    br: { x: right, y: bottom },
    bl: { x: left, y: bottom },
  };
}

function quadIsDefault(quad: CropQuad) {
  return (Object.keys(DEFAULT_QUAD) as CropPointKey[]).every((key) => {
    const a = DEFAULT_QUAD[key];
    const b = quad[key];
    return Math.abs(a.x - b.x) < 0.003 && Math.abs(a.y - b.y) < 0.003;
  });
}

function quadIsAxisAligned(quad: CropQuad) {
  return (
    Math.abs(quad.tl.y - quad.tr.y) < 0.004 &&
    Math.abs(quad.bl.y - quad.br.y) < 0.004 &&
    Math.abs(quad.tl.x - quad.bl.x) < 0.004 &&
    Math.abs(quad.tr.x - quad.br.x) < 0.004
  );
}

function pngSize(bytes: Uint8Array) {
  if (
    bytes.length > 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: 1, height: 1.414 };
}

function isPdfBytes(bytes: Uint8Array) {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function assertPdfBytes(bytes: Uint8Array, label: string) {
  if (!isPdfBytes(bytes)) {
    throw new Error(`${label} did not produce a valid PDF. Check that the conversion server is running the newest FileMint code.`);
  }
}

function mapFilter(filter: FilterId): ImageEditOptions['filter'] {
  if (filter === 'original') return 'none';
  if (filter === 'grayscale' || filter === 'light-text') return 'grayscale';
  if (filter === 'bw' || filter === 'whiteboard') return 'bw';
  return 'contrast';
}

function parseNumber(value: string, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampPercent(value: string) {
  return Math.max(0, Math.min(80, parseNumber(value, 0)));
}

function formatPercent(value: number) {
  return String(Math.round(value * 10) / 10);
}

function pageSizeForPdf(choice: PageSizeChoice): PageSizeKey {
  return choice === 'auto' ? 'fit' : choice;
}

function orientationForPdf(choice: OrientationChoice): Orientation {
  return choice === 'landscape' ? 'landscape' : 'portrait';
}

function parseDelimitedRows(text: string, delimiter: string) {
  if (!delimiter || delimiter === ',') return parseCsvRows(text);
  const escaped = delimiter === 'tab' ? '\t' : delimiter;
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split(escaped))
    .filter((row) => row.some((cell) => cell.trim()));
}

async function renderWithServer(bytes: Uint8Array, onProgress?: (p: number) => void): Promise<RenderedImage[]> {
  const temp = await storage.saveBytes(bytes, 'pdf');
  const uri = await storage.getUri(temp.key);
  const res = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: 'preview.pdf',
    mime: 'application/pdf',
    fields: { format: 'png', dpi: 160 },
  });
  onProgress?.(0.65);
  const zip = await JSZip.loadAsync(res.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: RenderedImage[] = [];
  for (const entry of entries) out.push({ bytes: await entry.async('uint8array'), ext: 'png' });
  if (!out.length) throw new Error('The server did not return preview pages.');
  return out;
}

async function renderPages(bytes: Uint8Array, onProgress?: (p: number) => void): Promise<RenderedImage[]> {
  try {
    return await renderPdfToImages(cloneBytes(bytes), 'png', 1.55, onProgress);
  } catch {
    return renderWithServer(cloneBytes(bytes), onProgress);
  }
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode preview image for crop.'));
    img.src = src;
  });
}

function applyCanvasFilter(ctx: CanvasRenderingContext2D, width: number, height: number, filter: FilterId) {
  if (filter === 'original') return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const contrast =
    filter === 'high-contrast' || filter === 'whiteboard' || filter === 'bw'
      ? 1.9
      : filter === 'enhance-2' || filter === 'magic-color' || filter === 'clean-bg'
        ? 1.42
        : filter === 'photo'
          ? 1.08
          : 1.25;
  const brightness =
    filter === 'brighter' || filter === 'light-text'
      ? 22
      : filter === 'darker'
        ? -22
        : filter === 'clean-bg' || filter === 'remove-shadows' || filter === 'whiteboard'
          ? 16
          : 0;
  const saturation = filter === 'photo' || filter === 'magic-color' || filter === 'auto-color' ? 1.22 : 1;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;

    if (filter === 'grayscale' || filter === 'light-text') {
      r = gray;
      g = gray;
      b = gray;
    } else if (filter === 'bw' || filter === 'whiteboard') {
      const v = gray > (filter === 'whiteboard' ? 170 : 150) ? 255 : 0;
      r = v;
      g = v;
      b = v;
    } else {
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
    }

    r = (r - 128) * contrast + 128 + brightness;
    g = (g - 128) * contrast + 128 + brightness;
    b = (b - 128) * contrast + 128 + brightness;

    if (filter === 'clean-bg' || filter === 'remove-shadows' || filter === 'whiteboard') {
      const light = (r + g + b) / 3;
      if (light > 205) {
        r = 255;
        g = 255;
        b = 255;
      }
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(image, 0, 0);
}

async function editedPreviewImage(page: StudioPage, previewBytes: Uint8Array): Promise<{ bytes: Uint8Array; ext: 'png' }> {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') {
    const temp = await storage.saveBytes(previewBytes, 'png');
    const prepared = await prepareImageForPdf(temp.key, 'png', { filter: mapFilter(page.filter) });
    return { bytes: prepared.bytes, ext: 'png' };
  }

  const image = await loadBrowserImage(dataUrl('image/png', previewBytes));
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const quad = page.quad;
  const points = [quad.tl, quad.tr, quad.br, quad.bl].map((point) => ({
    x: clamp01(point.x) * sourceWidth,
    y: clamp01(point.y) * sourceHeight,
  }));
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const maxX = Math.min(sourceWidth, Math.ceil(Math.max(...points.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(sourceHeight, Math.ceil(Math.max(...points.map((point) => point.y))));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable for crop preview.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x - minX;
    const y = point.y - minY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, -minX, -minY);
  ctx.restore();
  applyCanvasFilter(ctx, width, height, page.filter);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode cropped page.'))), 'image/png', 0.96),
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
}

async function sourcePdfFromFile(
  file: FileItem,
  settings: {
    pageSize: PageSizeChoice;
    orientation: OrientationChoice;
    margin: MarginKey;
    csvDelimiter: string;
    textFontSize: string;
  },
): Promise<{ bytes: Uint8Array; report?: ConversionReport }> {
  if (file.kind === 'word' || file.kind === 'ppt' || file.kind === 'excel') {
    const uri = await storage.getUri(file.storageKey);
    const res = await convertFile({
      endpoint: 'convert',
      fileUri: uri,
      fileName: file.name,
      mime: file.mime,
      fields: { target: 'pdf' },
    });
    assertPdfBytes(res.bytes, file.name);
    return { bytes: res.bytes, report: res.report };
  }

  if (file.kind === 'image') {
    const image = await prepareImageForPdf(file.storageKey, file.ext, {});
    const pdf = await imagesToPdf([image], {
      pageSize: pageSizeForPdf(settings.pageSize),
      orientation: orientationForPdf(settings.orientation),
      margin: marginPoints(settings.margin),
      fit: 'contain',
    });
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  const raw = decodeUtf8(await storage.readBytes(file.storageKey));
  if (file.kind === 'csv' || file.ext === 'csv') {
    const rows = parseDelimitedRows(raw, settings.csvDelimiter);
    if (!rows.length) throw new Error(`${file.name} does not contain readable CSV rows.`);
    const pdf = await csvRowsToPdf(rows, baseName(file.name));
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  if (file.kind === 'text') {
    const pdf = await textToPdf(raw, {
      title: baseName(file.name),
      fontSize: Math.max(7, Math.min(24, parseNumber(settings.textFontSize, 11))),
      pageSize: settings.pageSize === 'legal' ? 'legal' : settings.pageSize === 'letter' ? 'letter' : 'a4',
    });
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  throw new Error(`${file.name} is not supported for PDF conversion.`);
}

export default function ConvertToPdfScreen() {
  const params = useLocalSearchParams<{ profile?: string }>();
  const profile = normalizeProfile(params.profile);
  const theme = useTheme();
  const desktop = useIsDesktop();
  const runner = useRunner();

  const [files, setFiles] = useState<FileItem[]>([]);
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [pages, setPages] = useState<StudioPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [fileName, setFileName] = useState('Converted document');
  const [pageSize, setPageSize] = useState<PageSizeChoice>('auto');
  const [orientation, setOrientation] = useState<OrientationChoice>('auto');
  const [margin, setMargin] = useState<MarginKey>('small');
  const [quality, setQuality] = useState<Quality>('high');
  const [exportMode, setExportMode] = useState<ExportMode>(profile === 'batch' ? 'separate' : 'merge');
  const [csvDelimiter, setCsvDelimiter] = useState(',');
  const [textFontSize, setTextFontSize] = useState('11');
  const [cropTop, setCropTop] = useState('0');
  const [cropRight, setCropRight] = useState('0');
  const [cropBottom, setCropBottom] = useState('0');
  const [cropLeft, setCropLeft] = useState('0');
  const [fullscreen, setFullscreen] = useState(false);

  const selectedPage = useMemo(() => pages.find((page) => page.id === selectedId) ?? pages[0], [pages, selectedId]);
  const selectedIndex = Math.max(0, pages.findIndex((page) => page.id === selectedPage?.id));
  const includedCount = pages.filter((page) => page.included).length;
  const filterCount = pages.filter((page) => page.filter !== 'original').length;
  const cropCount = pages.filter((page) => cropIsActive(page.crop)).length;
  const freeCropCount = pages.filter((page) => !quadIsDefault(page.quad) && !quadIsAxisAligned(page.quad)).length;

  const prepareFiles = async (nextFiles: FileItem[]) => {
    setPreparing(true);
    setPrepareError(null);
    setPrepareProgress(0);
    try {
      const nextSources: SourceDoc[] = [];
      const nextPages: StudioPage[] = [];
      for (let i = 0; i < nextFiles.length; i++) {
        const file = nextFiles[i];
        setPrepareProgress(i / Math.max(1, nextFiles.length));
        const { bytes, report } = await sourcePdfFromFile(file, {
          pageSize,
          orientation,
          margin,
          csvDelimiter,
          textFontSize,
        });
        const sourceBytes = cloneBytes(bytes);
        const sourceId = uid('src_');
        const rendered = await renderPages(cloneBytes(bytes), (p) => {
          setPrepareProgress((i + p * 0.8) / Math.max(1, nextFiles.length));
        });
        nextSources.push({ id: sourceId, file, pdfBytes: sourceBytes, pageCount: rendered.length, report });
        rendered.forEach((image, index) => {
          const { width, height } = pngSize(image.bytes);
          nextPages.push({
            id: uid('page_'),
            sourceId,
            fileId: file.id,
            fileName: file.name,
            fileKind: file.kind,
            sourceIndex: index,
            previewBytes: image.bytes,
            previewUri: dataUrl('image/png', image.bytes),
            previewWidth: width,
            previewHeight: height,
            included: true,
            rotation: 0,
            filter: 'original',
            crop: { top: 0, right: 0, bottom: 0, left: 0 },
            quad: cloneQuad(DEFAULT_QUAD),
          });
        });
      }
      setSources(nextSources);
      setPages(nextPages);
      setSelectedId(nextPages[0]?.id ?? null);
      setFullscreen(nextPages.length > 0);
      if (nextFiles.length === 1) setFileName(baseName(nextFiles[0].name));
      else if (nextFiles.length > 1) setFileName('Merged PDF');
      setPrepareProgress(1);
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : 'Could not prepare the PDF preview.');
    } finally {
      setPreparing(false);
    }
  };

  const pickFiles = async () => {
    const picked = await pickDocuments({ multiple: true, type: pickTypes(profile) });
    if (!picked.length) return;
    const imported: FileItem[] = [];
    for (const item of picked) {
      const ext = extFromName(item.name);
      if (!SUPPORTED_EXTS.has(ext)) continue;
      const file = await importIntoLibrary(item, 'import');
      if (supportsProfile(file, profile)) imported.push(file);
    }
    if (!imported.length) {
      setPrepareError('Choose Word, PowerPoint, Excel, image, CSV, or text files with supported extensions.');
      return;
    }
    const next = [...files, ...imported];
    setFiles(next);
    await prepareFiles(next);
  };

  const rebuildPreview = () => {
    if (!files.length || preparing) return;
    void prepareFiles(files);
  };

  const updatePage = (id: string, patch: Partial<StudioPage>) => {
    setPages((prev) => prev.map((page) => (page.id === id ? { ...page, ...patch } : page)));
  };

  const selectPage = (page: StudioPage) => {
    setSelectedId(page.id);
    setCropTop(formatPercent(page.crop.top));
    setCropRight(formatPercent(page.crop.right));
    setCropBottom(formatPercent(page.crop.bottom));
    setCropLeft(formatPercent(page.crop.left));
  };

  const selectPageByIndex = (index: number) => {
    const page = pages[Math.max(0, Math.min(pages.length - 1, index))];
    if (page) selectPage(page);
  };

  const goToAdjacentPage = (dir: -1 | 1) => {
    if (!pages.length) return;
    selectPageByIndex(selectedIndex + dir);
  };

  const updatePageQuad = (id: string, quad: CropQuad) => {
    const crop = cropFromQuad(quad);
    if (id === selectedPage?.id) {
      setCropTop(formatPercent(crop.top));
      setCropRight(formatPercent(crop.right));
      setCropBottom(formatPercent(crop.bottom));
      setCropLeft(formatPercent(crop.left));
    }
    setPages((prev) => prev.map((page) => (page.id === id ? { ...page, quad, crop } : page)));
  };

  const updateCurrentCrop = (all: boolean) => {
    const crop = {
      top: clampPercent(cropTop),
      right: clampPercent(cropRight),
      bottom: clampPercent(cropBottom),
      left: clampPercent(cropLeft),
    };
    const quad = quadFromCrop(crop);
    setPages((prev) => prev.map((page) => (all || page.id === selectedPage?.id ? { ...page, crop, quad } : page)));
  };

  const resetCrop = (all: boolean) => {
    setCropTop('0');
    setCropRight('0');
    setCropBottom('0');
    setCropLeft('0');
    setPages((prev) =>
      prev.map((page) =>
        all || page.id === selectedPage?.id
          ? { ...page, crop: { top: 0, right: 0, bottom: 0, left: 0 }, quad: cloneQuad(DEFAULT_QUAD) }
          : page,
      ),
    );
  };

  const movePage = (id: string, dir: -1 | 1) => {
    setPages((prev) => {
      const index = prev.findIndex((page) => page.id === id);
      const nextIndex = index + dir;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  };

  const rotateCurrent = () => {
    if (!selectedPage) return;
    const next = ((selectedPage.rotation + 90) % 360) as Rotation;
    updatePage(selectedPage.id, { rotation: next });
  };

  const applyFilter = (filter: FilterId, all: boolean) => {
    setPages((prev) => prev.map((page) => (all || page.id === selectedPage?.id ? { ...page, filter } : page)));
  };

  const makePagePdf = async (page: StudioPage): Promise<Uint8Array> => {
    const source = sources.find((item) => item.id === page.sourceId);
    if (!source) throw new Error(`Missing source for ${page.fileName}.`);
    let bytes = await extractPages(source.pdfBytes, [page.sourceIndex]);
    if (page.rotation) bytes = await rotatePages(bytes, [0], page.rotation);
    const hasQuadCrop = !quadIsDefault(page.quad);
    const axisAlignedCrop = quadIsAxisAligned(page.quad);
    const needsRaster = page.filter !== 'original' || (hasQuadCrop && !axisAlignedCrop);

    if (!needsRaster && hasQuadCrop) {
      return cropPdfEdges(bytes, { ...cropFromQuad(page.quad), unit: 'percent' }, [0]);
    }
    if (!needsRaster) return bytes;

    let rasterPage = page;
    if (hasQuadCrop && axisAlignedCrop) {
      bytes = await cropPdfEdges(bytes, { ...cropFromQuad(page.quad), unit: 'percent' }, [0]);
      rasterPage = { ...page, quad: cloneQuad(DEFAULT_QUAD), crop: { top: 0, right: 0, bottom: 0, left: 0 } };
    }

    const rendered = await renderPages(bytes);
    const edited = await editedPreviewImage(rasterPage, rendered[0].bytes);
    return imagesToPdf([edited], {
      pageSize: pageSizeForPdf(pageSize),
      orientation: orientationForPdf(orientation),
      margin: marginPoints(margin),
      fit: 'contain',
    });
  };

  const exportPdf = () =>
    runner.run(async (onProgress) => {
      const selected = pages.filter((page) => page.included);
      if (!selected.length) throw new Error('Include at least one page before converting.');

      if (exportMode === 'separate' && sources.length > 1) {
        const saved: FileItem[] = [];
        for (let i = 0; i < sources.length; i++) {
          const source = sources[i];
          const sourcePages = selected.filter((page) => page.sourceId === source.id);
          if (!sourcePages.length) continue;
          const pieces: Uint8Array[] = [];
          for (const page of sourcePages) pieces.push(await makePagePdf(page));
          let out = pieces.length === 1 ? pieces[0] : await mergePdfs(pieces);
          if (quality !== 'original') out = await optimizePdf(out);
          saved.push(
            await useLibrary.getState().saveResult({
              bytes: out,
              name: withExt(`${baseName(source.file.name)} PDF`, 'pdf'),
              kind: 'pdf',
              ext: 'pdf',
              mime: 'application/pdf',
              pageCount: sourcePages.length,
              source: 'convert',
              conversionReport: buildReport(sourcePages.length, filterCount, cropCount, freeCropCount, source.report),
            }),
          );
          onProgress((i + 1) / sources.length);
        }
        if (!saved.length) throw new Error('No selected pages were exported.');
        return saved;
      }

      const pieces: Uint8Array[] = [];
      for (let i = 0; i < selected.length; i++) {
        pieces.push(await makePagePdf(selected[i]));
        onProgress(((i + 1) / selected.length) * 0.82);
      }
      let out = pieces.length === 1 ? pieces[0] : await mergePdfs(pieces);
      if (quality !== 'original') out = await optimizePdf(out);
      onProgress(0.94);
      const file = await useLibrary.getState().saveResult({
        bytes: out,
        name: withExt(fileName || 'Converted document', 'pdf'),
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        pageCount: selected.length,
        source: 'convert',
        conversionReport: buildReport(selected.length, filterCount, cropCount, freeCropCount, sources[0]?.report),
      });
      onProgress(1);
      return file;
    });

  const dashboardContent = (
    <>
      <Card style={styles.panel}>
        <Txt variant="h3">Crop</Txt>
        <Txt variant="caption" muted>
          Drag the page corners or enter exact edge percentages.
        </Txt>
        <View style={styles.cropGrid}>
          <TextField label="Top %" value={cropTop} onChangeText={setCropTop} keyboardType="numeric" />
          <TextField label="Right %" value={cropRight} onChangeText={setCropRight} keyboardType="numeric" />
          <TextField label="Bottom %" value={cropBottom} onChangeText={setCropBottom} keyboardType="numeric" />
          <TextField label="Left %" value={cropLeft} onChangeText={setCropLeft} keyboardType="numeric" />
        </View>
        <View style={styles.actionsRow}>
          <Button title="Current" size="sm" icon="crop" variant="secondary" onPress={() => updateCurrentCrop(false)} style={styles.actionButton} />
          <Button title="All" size="sm" icon="crop-free" onPress={() => updateCurrentCrop(true)} style={styles.actionButton} />
        </View>
        <View style={styles.actionsRow}>
          <Button title="A4 crop" size="sm" variant="secondary" onPress={() => {
            setCropTop('3'); setCropRight('3'); setCropBottom('3'); setCropLeft('3'); updateCurrentCrop(false);
          }} style={styles.actionButton} />
          <Button title="Reset" size="sm" variant="ghost" onPress={() => resetCrop(false)} style={styles.actionButton} />
        </View>
      </Card>

      <Card style={styles.panel}>
        <View style={styles.rowBetween}>
          <Txt variant="h3">Filters</Txt>
          <Txt variant="tiny" muted>
            {filterCount} applied
          </Txt>
        </View>
        <ScrollView
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={styles.filterScroller}
          contentContainerStyle={styles.filterGrid}>
          {FILTERS.map((filter) => {
            const active = selectedPage?.filter === filter.value;
            return (
              <Pressable
                key={filter.value}
                onPress={() => applyFilter(filter.value, false)}
                style={[
                  styles.filterChip,
                  {
                    borderColor: active ? theme.primary : theme.border,
                    backgroundColor: active ? withAlpha(theme.primary, 0.16) : theme.backgroundElement,
                  },
                ]}>
                <Icon name={filter.icon} size={17} color={active ? theme.primary : theme.textSecondary} />
                <Txt variant="tiny" weight="700" numberOfLines={1} style={{ color: active ? theme.primary : theme.text }}>
                  {filter.label}
                </Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.actionsRow}>
          <Button title="Apply all" size="sm" icon="image-filter-center-focus" onPress={() => selectedPage && applyFilter(selectedPage.filter, true)} style={styles.actionButton} />
          <Button title="Reset" size="sm" variant="ghost" icon="restore" onPress={() => applyFilter('original', true)} style={styles.actionButton} />
        </View>
        <Txt variant="tiny" muted>
          Filters create image-finished pages. Leave Original for the sharpest document PDF.
        </Txt>
      </Card>

      <Card style={styles.panel}>
        <Txt variant="h3">Output</Txt>
        <Field label="Export mode">
          <Segmented options={EXPORT_OPTIONS} value={exportMode} onChange={setExportMode} />
        </Field>
        <Field label="Page size">
          <Segmented options={PAGE_SIZE_OPTIONS} value={pageSize} onChange={setPageSize} />
        </Field>
        <Field label="Orientation">
          <Segmented options={ORIENTATION_OPTIONS} value={orientation} onChange={setOrientation} />
        </Field>
        <Field label="Margins">
          <Segmented options={MARGIN_OPTIONS} value={margin} onChange={setMargin} />
        </Field>
        <Field label="Quality">
          <Segmented options={QUALITY_OPTIONS} value={quality} onChange={setQuality} />
        </Field>
        <TextField label="File name" value={fileName} onChangeText={setFileName} placeholder="Converted document" />
        {files.some((file) => file.kind === 'csv' || file.kind === 'text') ? (
          <View style={{ gap: Spacing.sm }}>
            <TextField label="CSV delimiter" value={csvDelimiter} onChangeText={setCsvDelimiter} placeholder="," />
            <TextField label="Text font size" value={textFontSize} onChangeText={setTextFontSize} keyboardType="numeric" />
            <Button title="Update preview" icon="refresh" variant="secondary" onPress={rebuildPreview} disabled={preparing} full />
          </View>
        ) : null}
        <Button
          title="Convert to PDF"
          icon="file-pdf-box"
          size="lg"
          onPress={exportPdf}
          loading={runner.state === 'running'}
          disabled={!includedCount || preparing}
          full
        />
      </Card>
    </>
  );

  const selectedPreviewStyle = selectedPage?.filter === 'original' ? undefined : webFilterStyle(selectedPage?.filter ?? 'original');
  const renderPreviewCanvas = (large = false) =>
    selectedPage ? (
      <View style={[styles.previewWrap, large && styles.previewWrapFullscreen]}>
        <View
          style={[
            styles.previewStage,
            large && styles.previewStageFullscreen,
            {
              aspectRatio: Math.max(0.12, selectedPage.previewWidth / Math.max(1, selectedPage.previewHeight)),
              transform: [{ rotate: `${selectedPage.rotation}deg` }],
            },
            !selectedPage.included && { opacity: 0.36 },
          ]}>
          <Image
            source={{ uri: selectedPage.previewUri }}
            resizeMode="stretch"
            style={[styles.previewImage as ImageStyle, selectedPreviewStyle]}
          />
          <CropOverlay page={selectedPage} onChange={(quad) => updatePageQuad(selectedPage.id, quad)} />
        </View>
        {!selectedPage.included ? (
          <View style={styles.excludedBadge}>
            <Icon name="eye-off-outline" size={16} color="#FFFFFF" />
            <Txt variant="label" style={{ color: '#FFFFFF' }}>
              Excluded
            </Txt>
          </View>
        ) : null}
        <IconButton
          name="chevron-left"
          size={30}
          onPress={() => goToAdjacentPage(-1)}
          disabled={selectedIndex <= 0}
          accessibilityLabel="Previous page"
          style={StyleSheet.flatten([styles.pageArrow, styles.pageArrowLeft])}
        />
        <IconButton
          name="chevron-right"
          size={30}
          onPress={() => goToAdjacentPage(1)}
          disabled={selectedIndex >= pages.length - 1}
          accessibilityLabel="Next page"
          style={StyleSheet.flatten([styles.pageArrow, styles.pageArrowRight])}
        />
      </View>
    ) : null;

  return (
    <Screen scroll padded contentContainerStyle={{ paddingBottom: 42 }}>
      <AppHeader
        title={profileTitle(profile)}
        subtitle="Preview, crop, filter, reorder, then export"
        showBack
        right={
          files.length ? (
            <Button title="Add files" icon="plus" size="sm" variant="secondary" onPress={pickFiles} disabled={preparing || runner.state === 'running'} />
          ) : null
        }
      />

      {!files.length && !preparing ? (
        <HeroPick profile={profile} onPick={pickFiles} error={prepareError} />
      ) : null}

      {preparing ? (
        <Card style={styles.preparingCard}>
          <View style={styles.row}>
            <ActivityIndicator color={theme.primary} />
            <View style={{ flex: 1 }}>
              <Txt variant="h3">Generating editable preview</Txt>
              <Txt variant="caption" muted>
                Office files are rendered with LibreOffice; images, CSV, and text are paginated into PDF pages.
              </Txt>
            </View>
          </View>
          <ProgressBar progress={prepareProgress} indeterminate={prepareProgress <= 0} />
        </Card>
      ) : null}

      {prepareError && files.length ? (
        <Card style={{ borderColor: theme.danger, gap: Spacing.sm }}>
          <View style={styles.row}>
            <Icon name="alert-circle-outline" size={22} color={theme.danger} />
            <Txt variant="h3" style={{ color: theme.danger }}>
              Preview failed
            </Txt>
          </View>
          <Txt variant="caption" muted>
            {prepareError}
          </Txt>
          <Button title="Try again" icon="refresh" variant="secondary" onPress={rebuildPreview} full />
        </Card>
      ) : null}

      {pages.length ? (
        <View style={[styles.studio, desktop && styles.studioDesktop]}>
          <View style={[styles.leftRail, desktop && styles.leftRailDesktop]}>
            <Card style={styles.summaryCard}>
              <View style={styles.rowBetween}>
                <View>
                  <Txt variant="h3">Pages</Txt>
                  <Txt variant="caption" muted>
                    {includedCount} of {pages.length} included
                  </Txt>
                </View>
                <Chip label={files.length > 1 ? 'Batch' : 'Single'} active />
              </View>
              <View style={styles.actionsRow}>
                <Button title="All" size="sm" variant="secondary" onPress={() => setPages((prev) => prev.map((page) => ({ ...page, included: true })))} style={styles.actionButton} />
                <Button title="None" size="sm" variant="ghost" onPress={() => setPages((prev) => prev.map((page) => ({ ...page, included: false })))} style={styles.actionButton} />
              </View>
            </Card>

            <View style={styles.pageList}>
              {pages.map((page, index) => (
                <PageTile
                  key={page.id}
                  page={page}
                  index={index}
                  active={page.id === selectedPage?.id}
                  onPress={() => selectPage(page)}
                  onToggle={() => updatePage(page.id, { included: !page.included })}
                  onUp={() => movePage(page.id, -1)}
                  onDown={() => movePage(page.id, 1)}
                  canUp={index > 0}
                  canDown={index < pages.length - 1}
                />
              ))}
            </View>
          </View>

          <View style={styles.previewPane}>
            <Card padded={false} style={styles.previewCard}>
              <View style={[styles.previewToolbar, { backgroundColor: withAlpha(theme.background, 0.86), borderColor: theme.border }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="label" numberOfLines={1}>
                    Page {selectedIndex + 1} of {pages.length}
                  </Txt>
                  <Txt variant="tiny" muted numberOfLines={1}>
                    {selectedPage?.fileName ?? 'No page selected'}
                  </Txt>
                </View>
                <IconButton name="chevron-left" size={22} onPress={() => goToAdjacentPage(-1)} disabled={selectedIndex <= 0} accessibilityLabel="Previous page" />
                <IconButton name="chevron-right" size={22} onPress={() => goToAdjacentPage(1)} disabled={selectedIndex >= pages.length - 1} accessibilityLabel="Next page" />
                <IconButton name="fullscreen" size={22} onPress={() => setFullscreen(true)} accessibilityLabel="Open fullscreen editor" />
              </View>
              {renderPreviewCanvas(false)}
            </Card>
            {selectedPage ? (
              <Card style={styles.selectedMeta}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="label" numberOfLines={1}>
                    {selectedPage.fileName}
                  </Txt>
                  <Txt variant="tiny" muted>
                    Page {selectedPage.sourceIndex + 1} - {selectedPage.fileKind.toUpperCase()}
                  </Txt>
                </View>
                <IconButton name="rotate-right" size={22} onPress={rotateCurrent} accessibilityLabel="Rotate page" />
                <IconButton
                  name={selectedPage.included ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                  size={24}
                  color={selectedPage.included ? theme.primary : theme.textSecondary}
                  onPress={() => updatePage(selectedPage.id, { included: !selectedPage.included })}
                  accessibilityLabel="Include page"
                />
              </Card>
            ) : null}
            <PageFilmstrip pages={pages} selectedId={selectedPage?.id} onSelect={selectPage} />
          </View>

          <View style={[styles.rightRail, desktop && styles.rightRailDesktop]}>
            {dashboardContent}
          </View>
        </View>
      ) : null}

      <ToolOutcome runner={runner} runningLabel="Creating final PDF..." doneLabel="PDF ready" />
      <Modal visible={fullscreen && !!selectedPage} animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <View style={[styles.fullscreenShell, { backgroundColor: theme.background }]}>
          <View style={[styles.fullscreenHeader, { borderColor: theme.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="h3" numberOfLines={1}>
                Fullscreen page editor
              </Txt>
              <Txt variant="caption" muted numberOfLines={1}>
                Page {selectedIndex + 1} of {pages.length} - crop, filter, and export from the dashboard
              </Txt>
            </View>
            <IconButton name="chevron-left" size={24} onPress={() => goToAdjacentPage(-1)} disabled={selectedIndex <= 0} accessibilityLabel="Previous page" />
            <IconButton name="chevron-right" size={24} onPress={() => goToAdjacentPage(1)} disabled={selectedIndex >= pages.length - 1} accessibilityLabel="Next page" />
            <IconButton name="fullscreen-exit" size={24} onPress={() => setFullscreen(false)} accessibilityLabel="Close fullscreen editor" />
          </View>
          <View style={styles.fullscreenBody}>
            <View style={styles.fullscreenPreviewPane}>
              <View style={[styles.fullscreenPreviewCard, { backgroundColor: '#6F747B' }]}>
                {renderPreviewCanvas(true)}
              </View>
              <PageFilmstrip pages={pages} selectedId={selectedPage?.id} onSelect={selectPage} />
            </View>
            <ScrollView style={[styles.fullscreenDashboard, { borderColor: theme.border }]} contentContainerStyle={styles.fullscreenDashboardContent} showsVerticalScrollIndicator>
              {dashboardContent}
              <ToolOutcome runner={runner} runningLabel="Creating final PDF..." doneLabel="PDF ready" />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function buildReport(
  pagesConverted: number,
  filters: number,
  crops: number,
  freeCrops: number,
  sourceReport?: ConversionReport,
): ConversionReport {
  const warnings = [...(sourceReport?.warnings ?? [])];
  if (filters) warnings.push('Filtered pages are rasterized because visual filters change page pixels.');
  if (freeCrops) warnings.push('Free-shape cropped pages are rasterized so the exported PDF follows the visible quadrilateral crop.');
  return {
    ...sourceReport,
    engine: 'FileMint PDF Studio',
    resolvedMode: 'convert-to-pdf-preflight',
    pagesConverted,
    visualObjectsPreserved: pagesConverted,
    notes: [
      `${pagesConverted} page${pagesConverted === 1 ? '' : 's'} exported after preview.`,
      crops
        ? `${crops} cropped page${crops === 1 ? '' : 's'} exported; rectangular crops use PDF crop boxes, free crops use a raster crop.`
        : 'No page crops applied.',
    ],
    warnings,
  };
}

function HeroPick({ profile, onPick, error }: { profile: StudioProfile; onPick: () => void; error: string | null }) {
  const theme = useTheme();
  return (
    <Card style={styles.hero}>
      <View style={[styles.heroIcon, { backgroundColor: withAlpha(theme.primary, 0.14) }]}>
        <Icon name="file-document-plus-outline" size={34} color={theme.primary} />
      </View>
      <Txt variant="display" center>
        {profileTitle(profile)}
      </Txt>
      <Txt variant="caption" muted center>
        Choose one or more supported files. FileMint opens a preview editor before it creates the PDF.
      </Txt>
      <Button title="Choose files" icon="folder-open-outline" size="lg" onPress={onPick} full />
      <View style={styles.formatRow}>
        {['DOCX', 'PPTX', 'XLSX', 'JPG', 'PNG', 'WEBP', 'HEIC', 'CSV', 'TXT'].map((item) => (
          <View key={item} style={[styles.formatPill, { borderColor: theme.border, backgroundColor: theme.backgroundElement }]}>
            <Txt variant="tiny" weight="800">
              {item}
            </Txt>
          </View>
        ))}
      </View>
      {error ? (
        <Txt variant="caption" center style={{ color: theme.danger }}>
          {error}
        </Txt>
      ) : null}
    </Card>
  );
}

function CropOverlay({ page, onChange }: { page: StudioPage; onChange: (quad: CropQuad) => void }) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 1, height: 1 });
  const keys: CropPointKey[] = ['tl', 'tr', 'br', 'bl'];
  const points = keys.map((key) => ({
    key,
    x: page.quad[key].x * size.width,
    y: page.quad[key].y * size.height,
  }));
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const shadePath = `M0,0H${size.width}V${size.height}H0Z M${points.map((point) => `${point.x},${point.y}`).join(' L')} Z`;

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize({ width, height });
  };

  const setPoint = (key: CropPointKey, point: CropPoint) => {
    onChange({
      ...cloneQuad(page.quad),
      [key]: {
        x: clamp01(point.x),
        y: clamp01(point.y),
      },
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={handleLayout}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={shadePath} fill="rgba(0,0,0,0.28)" fillRule="evenodd" />
        <Polygon points={polygon} fill="rgba(255,255,255,0.01)" stroke={theme.primary} strokeWidth={2.4} />
        <Line x1={points[0].x} y1={points[0].y} x2={points[2].x} y2={points[2].y} stroke="rgba(255,255,255,0.32)" strokeWidth={1} strokeDasharray="5 6" />
        <Line x1={points[1].x} y1={points[1].y} x2={points[3].x} y2={points[3].y} stroke="rgba(255,255,255,0.32)" strokeWidth={1} strokeDasharray="5 6" />
        {points.map((point) => (
          <Circle key={point.key} cx={point.x} cy={point.y} r={7} fill={theme.primary} stroke="#FFFFFF" strokeWidth={2} />
        ))}
      </Svg>
      {points.map((point) => (
        <CropHandle
          key={point.key}
          pointKey={point.key}
          point={page.quad[point.key]}
          stage={size}
          onChange={setPoint}
        />
      ))}
      <View style={[styles.cropHint, { backgroundColor: withAlpha(theme.background, 0.82), borderColor: theme.border }]}>
        <Icon name="cursor-move" size={14} color={theme.primary} />
        <Txt variant="tiny" weight="800">
          Drag corners
        </Txt>
      </View>
    </View>
  );
}

function CropHandle({
  pointKey,
  point,
  stage,
  onChange,
}: {
  pointKey: CropPointKey;
  point: CropPoint;
  stage: { width: number; height: number };
  onChange: (key: CropPointKey, point: CropPoint) => void;
}) {
  const start = useRef(point);
  const latest = useRef(point);
  const latestStage = useRef(stage);
  const latestOnChange = useRef(onChange);
  latest.current = point;
  latestStage.current = stage;
  latestOnChange.current = onChange;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current;
      },
      onPanResponderMove: (_, gesture) => {
        const width = Math.max(1, latestStage.current.width);
        const height = Math.max(1, latestStage.current.height);
        latestOnChange.current(pointKey, {
          x: start.current.x + gesture.dx / width,
          y: start.current.y + gesture.dy / height,
        });
      },
    }),
  ).current;

  return (
    <View
      {...pan.panHandlers}
      style={[
        styles.cropHandle,
        {
          left: `${point.x * 100}%`,
          top: `${point.y * 100}%`,
        },
      ]}
    />
  );
}

function PageFilmstrip({
  pages,
  selectedId,
  onSelect,
}: {
  pages: StudioPage[];
  selectedId?: string;
  onSelect: (page: StudioPage) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.filmstripWrap, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.filmstripContent}>
        {pages.map((page, index) => {
          const active = page.id === selectedId;
          return (
            <Pressable
              key={page.id}
              onPress={() => onSelect(page)}
              style={[
                styles.filmstripItem,
                {
                  borderColor: active ? theme.primary : theme.border,
                  backgroundColor: active ? withAlpha(theme.primary, 0.14) : theme.card,
                },
              ]}>
              <Image source={{ uri: page.previewUri }} resizeMode="cover" style={[styles.filmstripThumb as ImageStyle, !page.included && { opacity: 0.42 }]} />
              <View style={styles.filmstripLabel}>
                <Txt variant="tiny" weight="800" numberOfLines={1} style={{ color: active ? theme.primary : theme.text }}>
                  {index + 1}
                </Txt>
                {page.filter !== 'original' || cropIsActive(page.crop) ? (
                  <View style={[styles.filmstripDot, { backgroundColor: theme.primary }]} />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function PageTile({
  page,
  index,
  active,
  canUp,
  canDown,
  onPress,
  onToggle,
  onUp,
  onDown,
}: {
  page: StudioPage;
  index: number;
  active: boolean;
  canUp: boolean;
  canDown: boolean;
  onPress: () => void;
  onToggle: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  const theme = useTheme();
  const meta = kindMeta(page.fileKind);
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pageTile,
        {
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? withAlpha(theme.primary, 0.12) : theme.backgroundElement,
        },
      ]}>
      <Image source={{ uri: page.previewUri }} resizeMode="cover" style={[styles.pageThumb as ImageStyle, !page.included && { opacity: 0.4 }]} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.row}>
          <View style={[styles.kindDot, { backgroundColor: withAlpha(Accents[meta.accent], 0.18) }]}>
            <Icon name={meta.icon} size={14} color={Accents[meta.accent]} />
          </View>
          <Txt variant="label" numberOfLines={1}>
            Page {index + 1}
          </Txt>
        </View>
        <Txt variant="tiny" muted numberOfLines={1}>
          {page.fileName}
        </Txt>
        <Txt variant="tiny" muted>
          {page.filter !== 'original' ? 'Filtered' : 'Original'} - {cropIsActive(page.crop) ? 'Cropped' : 'Full'}
        </Txt>
      </View>
      <View style={styles.tileActions}>
        <IconButton name="arrow-up" size={18} disabled={!canUp} onPress={onUp} accessibilityLabel="Move up" />
        <IconButton name="arrow-down" size={18} disabled={!canDown} onPress={onDown} accessibilityLabel="Move down" />
        <IconButton
          name={page.included ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
          size={21}
          color={page.included ? theme.primary : theme.textSecondary}
          onPress={onToggle}
          accessibilityLabel="Include page"
        />
      </View>
    </Pressable>
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

function webFilterStyle(filter: FilterId) {
  if (Platform.OS !== 'web') return undefined;
  if (filter === 'original') return undefined;
  if (filter === 'grayscale') return { filter: 'grayscale(1)' } as never;
  if (filter === 'bw' || filter === 'whiteboard') return { filter: 'grayscale(1) contrast(1.9)' } as never;
  if (filter === 'darker') return { filter: 'brightness(0.82) contrast(1.18)' } as never;
  if (filter === 'brighter' || filter === 'light-text') return { filter: 'brightness(1.18) contrast(1.08)' } as never;
  if (filter === 'photo') return { filter: 'saturate(1.18) contrast(1.05)' } as never;
  return { filter: 'contrast(1.35) saturate(1.08)' } as never;
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  heroIcon: { width: 68, height: 68, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  formatRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: Spacing.xs },
  formatPill: { borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  preparingCard: { gap: Spacing.md },
  studio: { gap: Spacing.md },
  studioDesktop: { flexDirection: 'row', alignItems: 'flex-start' },
  leftRail: { gap: Spacing.sm },
  leftRailDesktop: { width: 330 },
  rightRail: { gap: Spacing.md },
  rightRailDesktop: { width: 355 },
  previewPane: { flex: 1, minWidth: 0, gap: Spacing.sm },
  summaryCard: { gap: Spacing.sm },
  pageList: { gap: Spacing.sm },
  pageTile: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  pageThumb: { width: 48, height: 64, borderRadius: Radius.xs, backgroundColor: '#FFFFFF' },
  kindDot: { width: 24, height: 24, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  tileActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  previewCard: { minHeight: 460, overflow: 'hidden', backgroundColor: '#6F747B' },
  previewToolbar: {
    minHeight: 60,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  previewWrap: { minHeight: 460, padding: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  previewWrapFullscreen: { minHeight: 0, flex: 1, padding: Spacing.lg },
  previewStage: {
    width: '100%',
    maxWidth: 720,
    maxHeight: 720,
    borderRadius: Radius.xs,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  previewStageFullscreen: { maxWidth: '100%', maxHeight: '100%' },
  previewImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%', backgroundColor: '#FFFFFF' },
  pageArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    backgroundColor: 'rgba(6,10,15,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  pageArrowLeft: { left: Spacing.md },
  pageArrowRight: { right: Spacing.md },
  excludedBadge: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectedMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  filmstripWrap: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    minHeight: 112,
  },
  filmstripContent: { gap: Spacing.sm, paddingHorizontal: Spacing.sm },
  filmstripItem: {
    width: 74,
    borderWidth: 1,
    borderRadius: Radius.sm,
    padding: 5,
    gap: 5,
  },
  filmstripThumb: { width: '100%', height: 72, borderRadius: Radius.xs, backgroundColor: '#FFFFFF' },
  filmstripLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 14 },
  filmstripDot: { width: 7, height: 7, borderRadius: 4 },
  panel: { gap: Spacing.md },
  cropGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  filterScroller: { maxHeight: 244 },
  filterGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingRight: Spacing.xs },
  filterChip: {
    width: 114,
    minHeight: 58,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    justifyContent: 'center',
    gap: 5,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm },
  actionButton: { flex: 1 },
  cropHandle: {
    position: 'absolute',
    width: 34,
    height: 34,
    marginLeft: -17,
    marginTop: -17,
    borderRadius: 17,
  },
  cropHint: {
    position: 'absolute',
    left: Spacing.sm,
    bottom: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  fullscreenShell: { flex: 1 },
  fullscreenHeader: {
    minHeight: 68,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  fullscreenBody: { flex: 1, flexDirection: 'row', minHeight: 0 },
  fullscreenPreviewPane: { flex: 3, flexBasis: '60%', minWidth: 0, padding: Spacing.md, gap: Spacing.sm },
  fullscreenPreviewCard: { flex: 1, minHeight: 0, borderRadius: Radius.md, overflow: 'hidden' },
  fullscreenDashboard: { flex: 2, flexBasis: '40%', minWidth: 360, maxWidth: 760, borderLeftWidth: 1 },
  fullscreenDashboardContent: { padding: Spacing.md, gap: Spacing.md },
});
