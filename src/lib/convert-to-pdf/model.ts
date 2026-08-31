import type { SegmentedOption } from '@/components/ui';
import type { ImageEditOptions } from '@/lib/image';
import { pageSizeDimensions, type CropEdges, type Orientation, type PageSizeKey } from '@/lib/pdf';
import { parseCsvRows } from '@/lib/text';
import type { ConversionReport, FileItem, FileKind } from '@/types';

export type StudioProfile = 'all' | 'image' | 'word' | 'ppt' | 'excel' | 'csv' | 'text' | 'batch';
export type FilterId =
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
export type Quality = 'low' | 'medium' | 'high' | 'original';
export type MarginKey = 'none' | 'small' | 'medium' | 'large';
export type ExportMode = 'merge' | 'separate';
export type PageSizeChoice = 'auto' | Exclude<PageSizeKey, 'fit'>;
export type OrientationChoice = 'auto' | Orientation;
export type Rotation = 0 | 90 | 180 | 270;
export type CropPointKey = 'tl' | 'tr' | 'br' | 'bl';
export type CropPoint = { x: number; y: number };
export type CropQuad = Record<CropPointKey, CropPoint>;

export interface SourceDoc {
  id: string;
  file: FileItem;
  pdfBytes: Uint8Array;
  pageCount: number;
  report?: ConversionReport;
}

export interface StudioPage {
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
  pageWidthPt: number;
  pageHeightPt: number;
  included: boolean;
  rotation: Rotation;
  filter: FilterId;
  crop: Required<Pick<CropEdges, 'top' | 'right' | 'bottom' | 'left'>>;
  quad: CropQuad;
}

export const SUPPORTED_EXTS = new Set([
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

export const PROFILE_TOOL_IDS: Partial<Record<StudioProfile, string>> = {
  image: 'image-to-pdf',
  word: 'docx-to-pdf',
  ppt: 'pptx-to-pdf',
  excel: 'xlsx-to-pdf',
  csv: 'csv-to-pdf',
  text: 'txt-to-pdf',
  batch: 'batch-convert',
};

export const OFFICE_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

export const PAGE_SIZE_OPTIONS: SegmentedOption<PageSizeChoice>[] = [
  { label: 'Auto', value: 'auto' },
  { label: 'A4', value: 'a4' },
  { label: 'Letter', value: 'letter' },
  { label: 'Legal', value: 'legal' },
];
export const ORIENTATION_OPTIONS: SegmentedOption<OrientationChoice>[] = [
  { label: 'Auto', value: 'auto', icon: 'page-layout-header' },
  { label: 'Portrait', value: 'portrait', icon: 'crop-portrait' },
  { label: 'Landscape', value: 'landscape', icon: 'crop-landscape' },
];
export const MARGIN_OPTIONS: SegmentedOption<MarginKey>[] = [
  { label: 'None', value: 'none' },
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
];
export const QUALITY_OPTIONS: SegmentedOption<Quality>[] = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Original', value: 'original' },
];
export const EXPORT_OPTIONS: SegmentedOption<ExportMode>[] = [
  { label: 'One PDF', value: 'merge', icon: 'file-pdf-box' },
  { label: 'Separate', value: 'separate', icon: 'file-multiple-outline' },
];

export const FILTERS: { value: FilterId; label: string; icon: string }[] = [
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

export const DEFAULT_QUAD: CropQuad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

export function profileTitle(profile: StudioProfile) {
  if (profile === 'image') return 'Images to PDF';
  if (profile === 'word') return 'Word to PDF';
  if (profile === 'ppt') return 'PowerPoint to PDF';
  if (profile === 'excel') return 'Excel to PDF';
  if (profile === 'csv') return 'CSV to PDF';
  if (profile === 'text') return 'Text to PDF';
  if (profile === 'batch') return 'Batch to PDF';
  return 'Convert to PDF';
}

export function pickTypes(profile: StudioProfile): string | string[] {
  if (profile === 'image') return 'image/*';
  if (profile === 'word') return OFFICE_TYPES.slice(0, 2);
  if (profile === 'ppt') return OFFICE_TYPES.slice(2, 4);
  if (profile === 'excel') return OFFICE_TYPES.slice(4, 6);
  if (profile === 'csv') return ['text/csv', 'text/comma-separated-values', 'text/plain'];
  if (profile === 'text') return ['text/plain', 'text/markdown', 'text/*'];
  return ['image/*', 'text/*', ...OFFICE_TYPES];
}

export function supportsProfile(file: FileItem, profile: StudioProfile) {
  if (!SUPPORTED_EXTS.has(file.ext)) return false;
  if (profile === 'image') return file.kind === 'image';
  if (profile === 'word') return file.kind === 'word';
  if (profile === 'ppt') return file.kind === 'ppt';
  if (profile === 'excel') return file.kind === 'excel';
  if (profile === 'csv') return file.kind === 'csv' || file.ext === 'csv';
  if (profile === 'text') return file.kind === 'text' && file.ext !== 'csv';
  return (
    file.kind === 'image' ||
    file.kind === 'word' ||
    file.kind === 'ppt' ||
    file.kind === 'excel' ||
    file.kind === 'csv' ||
    file.kind === 'text'
  );
}

export function normalizeProfile(value: unknown): StudioProfile {
  const raw = Array.isArray(value) ? value[0] : value;
  if (
    raw === 'image' ||
    raw === 'word' ||
    raw === 'ppt' ||
    raw === 'excel' ||
    raw === 'csv' ||
    raw === 'text' ||
    raw === 'batch'
  )
    return raw;
  return 'all';
}

export function marginPoints(margin: MarginKey) {
  if (margin === 'none') return 0;
  if (margin === 'small') return 24;
  if (margin === 'medium') return 42;
  return 64;
}

export function cropIsActive(crop: StudioPage['crop']) {
  return crop.top > 0 || crop.right > 0 || crop.bottom > 0 || crop.left > 0;
}

export function cloneBytes(bytes: Uint8Array) {
  return new Uint8Array(bytes);
}

export function cloneQuad(quad: CropQuad = DEFAULT_QUAD): CropQuad {
  return {
    tl: { ...quad.tl },
    tr: { ...quad.tr },
    br: { ...quad.br },
    bl: { ...quad.bl },
  };
}

export function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function cropFromQuad(quad: CropQuad): StudioPage['crop'] {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const left = Math.min(...xs) * 100;
  const right = (1 - Math.max(...xs)) * 100;
  const top = Math.min(...ys) * 100;
  const bottom = (1 - Math.max(...ys)) * 100;
  return { top, right, bottom, left };
}

export function quadFromCrop(crop: StudioPage['crop']): CropQuad {
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

export function quadIsDefault(quad: CropQuad) {
  return (Object.keys(DEFAULT_QUAD) as CropPointKey[]).every((key) => {
    const a = DEFAULT_QUAD[key];
    const b = quad[key];
    return Math.abs(a.x - b.x) < 0.003 && Math.abs(a.y - b.y) < 0.003;
  });
}

export function quadIsAxisAligned(quad: CropQuad) {
  return (
    Math.abs(quad.tl.y - quad.tr.y) < 0.004 &&
    Math.abs(quad.bl.y - quad.br.y) < 0.004 &&
    Math.abs(quad.tl.x - quad.bl.x) < 0.004 &&
    Math.abs(quad.tr.x - quad.br.x) < 0.004
  );
}

export function pngSize(bytes: Uint8Array) {
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width, height };
  }
  return { width: 1, height: 1.414 };
}

export function isPdfBytes(bytes: Uint8Array) {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export function assertPdfBytes(bytes: Uint8Array, label: string) {
  if (!isPdfBytes(bytes)) {
    throw new Error(
      `${label} did not produce a valid PDF. Check that the conversion server is running the newest FileMint code.`,
    );
  }
}

export function mapFilter(filter: FilterId): ImageEditOptions['filter'] {
  if (filter === 'original') return 'none';
  if (filter === 'grayscale' || filter === 'light-text') return 'grayscale';
  if (filter === 'bw' || filter === 'whiteboard') return 'bw';
  return 'contrast';
}

export function parseNumber(value: string, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clampPercent(value: string) {
  return Math.max(0, Math.min(80, parseNumber(value, 0)));
}

export function formatPercent(value: number) {
  return String(Math.round(value * 10) / 10);
}

export function pageSizeForPdf(choice: PageSizeChoice): PageSizeKey {
  return choice === 'auto' ? 'fit' : choice;
}

export function orientationForPdf(choice: OrientationChoice): Orientation {
  return choice === 'landscape' ? 'landscape' : 'portrait';
}

export function orientationForPage(choice: OrientationChoice, width: number, height: number): Orientation {
  if (choice === 'landscape' || choice === 'portrait') return choice;
  return width > height ? 'landscape' : 'portrait';
}

export function outputPageBoxForRaster(
  sourceSize: { width: number; height: number },
  choice: PageSizeChoice,
  orientation: OrientationChoice,
  margin: MarginKey,
) {
  if (choice === 'auto') {
    return { width: sourceSize.width, height: sourceSize.height, margin: 0 };
  }
  const [width, height] = pageSizeDimensions(
    choice,
    orientationForPage(orientation, sourceSize.width, sourceSize.height),
  );
  return { width, height, margin: marginPoints(margin) };
}

export function pageAspectRatio(page: StudioPage) {
  const width =
    Number.isFinite(page.pageWidthPt) && page.pageWidthPt > 0 ? page.pageWidthPt : page.previewWidth;
  const height =
    Number.isFinite(page.pageHeightPt) && page.pageHeightPt > 0 ? page.pageHeightPt : page.previewHeight;
  return Math.max(0.12, width / Math.max(1, height));
}

export function parseDelimitedRows(text: string, delimiter: string) {
  if (!delimiter || delimiter === ',') return parseCsvRows(text);
  const escaped = delimiter === 'tab' ? '\t' : delimiter;
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split(escaped))
    .filter((row) => row.some((cell) => cell.trim()));
}

export function buildReport(
  pagesConverted: number,
  filters: number,
  crops: number,
  freeCrops: number,
  sourceReport?: ConversionReport,
): ConversionReport {
  const warnings = [...(sourceReport?.warnings ?? [])];
  if (filters) warnings.push('Filtered pages are rasterized because visual filters change page pixels.');
  if (freeCrops) {
    warnings.push(
      'Free-shape cropped pages are rasterized so the exported PDF follows the visible quadrilateral crop.',
    );
  }
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
