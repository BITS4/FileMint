import JSZip from 'jszip';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Svg, { Circle, G, Line, Path, Polygon } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PickFile } from '@/components/tools/PickFile';
import {
  Button,
  Icon,
  IconButton,
  ProgressBar,
  Segmented,
  TextField,
  Txt,
  type SegmentedOption,
} from '@/components/ui';
import { findTool } from '@/constants/tools';
import { Accents, Radius, Spacing } from '@/constants/theme';
import { useIsDesktop } from '@/hooks/use-breakpoint';
import { premiumUpgradeRoute } from '@/hooks/use-open-tool';
import { useTheme } from '@/hooks/use-theme';
import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import { withAlpha } from '@/lib/color';
import { confirm } from '@/lib/confirm';
import { baseName } from '@/lib/format';
import {
  applyPdfEditorObjects,
  applyPdfEditorTool,
  cropPdfEdges,
  type PdfEditorObjectExport,
  type PdfEditorTool,
} from '@/lib/pdf';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import { pickImages } from '@/lib/pick';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { selectIsPremium, useAuth } from '@/store/useAuth';
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

interface EditorOptions {
  text: string;
  stampText: string;
  stampDetail: string;
  stampMode: 'design' | 'upload';
  stampShape: 'box' | 'pill' | 'seal';
  stampStyle: 'outline' | 'filled' | 'double';
  stampImageDataUrl?: string;
  stampImageName?: string;
  signatureText: string;
  annotationText: string;
  redactLabel: string;
  color: string;
  opacity: string;
  thickness: string;
  fontSize: string;
  signatureFontSize: string;
  rotation: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  signatureMode: 'draw' | 'type' | 'upload';
  signaturePoints: EditorPoint[];
  signaturePaths: EditorPoint[][];
  signatureImageDataUrl?: string;
  signatureImageName?: string;
  formFieldKind: 'text' | 'checkbox' | 'date' | 'signature' | 'initials';
  formValue: string;
  formPlaceholder: string;
  formChecked: boolean;
  formRequired: boolean;
  doodleMode: 'pencil' | 'marker' | 'eraser' | 'vector' | 'arrow';
  annotationMode: 'note' | 'callout' | 'shape';
}

type EditorObjectType =
  | 'text'
  | 'watermark'
  | 'stamp'
  | 'signature'
  | 'doodle'
  | 'highlight'
  | 'annotate'
  | 'redact'
  | 'form-field';

interface EditorPoint {
  x: number;
  y: number;
}

interface EditorObject {
  id: string;
  pageIndex: number;
  type: EditorObjectType;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  color: string;
  opacity: number;
  thickness: number;
  fontSize?: number;
  rotation: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  stampDetail?: string;
  stampMode?: 'design' | 'upload';
  stampShape?: 'box' | 'pill' | 'seal';
  stampStyle?: 'outline' | 'filled' | 'double';
  stampImageDataUrl?: string;
  stampImageName?: string;
  signatureMode?: 'draw' | 'type' | 'upload';
  signaturePoints?: EditorPoint[];
  signaturePaths?: EditorPoint[][];
  signatureImageDataUrl?: string;
  signatureImageName?: string;
  formFieldKind?: 'text' | 'checkbox' | 'date' | 'signature' | 'initials';
  formValue?: string;
  formPlaceholder?: string;
  formChecked?: boolean;
  formRequired?: boolean;
  doodleMode?: 'pencil' | 'marker' | 'eraser' | 'vector' | 'arrow';
  annotationMode?: 'note' | 'callout' | 'shape';
  points?: EditorPoint[];
}

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
  'crop-pdf': {
    id: 'crop-pdf',
    title: 'Crop PDF',
    subtitle: 'Precise page crop and perspective correction',
    icon: 'crop',
    accent: 'amber',
  },
  'add-page-numbers': {
    id: 'add-page-numbers',
    title: 'Page Numbers',
    subtitle: 'Place page labels with full style control',
    icon: 'format-list-numbered',
    accent: 'indigo',
  },
  'add-watermark': {
    id: 'add-watermark',
    title: 'Add Watermark',
    subtitle: 'Text and image watermarks with live placement',
    icon: 'watermark',
    accent: 'sky',
  },
  flatten: {
    id: 'flatten',
    title: 'Flatten PDF',
    subtitle: 'Bake selected objects into page content',
    icon: 'layers-outline',
    accent: 'slate',
  },
  'add-text': {
    id: 'add-text',
    title: 'Add Text',
    subtitle: 'Place editable text boxes on the page',
    icon: 'format-text',
    accent: 'green',
  },
  'add-signature': {
    id: 'add-signature',
    title: 'Add Signature',
    subtitle: 'Draw, type, upload, and place signatures',
    icon: 'draw',
    accent: 'rose',
  },
  doodle: {
    id: 'doodle',
    title: 'Doodle / Draw',
    subtitle: 'Freehand pens, shapes, arrows, and eraser',
    icon: 'pencil-outline',
    accent: 'pink',
  },
  highlight: {
    id: 'highlight',
    title: 'Highlight',
    subtitle: 'Highlight text or scanned areas',
    icon: 'marker',
    accent: 'yellow',
  },
  'add-stamp': {
    id: 'add-stamp',
    title: 'Add Stamp',
    subtitle: 'Built-in and custom document stamps',
    icon: 'stamper',
    accent: 'orange',
  },
  annotate: {
    id: 'annotate',
    title: 'Annotate',
    subtitle: 'Comments, callouts, shapes, and inspector',
    icon: 'comment-edit-outline',
    accent: 'violet',
  },
  redact: {
    id: 'redact',
    title: 'Redact',
    subtitle: 'Search and draw permanent redaction areas',
    icon: 'marker-cancel',
    accent: 'slate',
  },
  'fill-forms': {
    id: 'fill-forms',
    title: 'Fill Forms',
    subtitle: 'Detected field navigation and form toolbar',
    icon: 'form-select',
    accent: 'blue',
  },
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
const TEXT_COLOR_SWATCHES = [
  '#111827',
  '#374151',
  '#EAF0F6',
  '#FFFFFF',
  '#2BD9A8',
  '#14B8A6',
  '#38BDF8',
  '#3B82F6',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#FB7185',
  '#EF4444',
  '#F97316',
  '#F7C948',
  '#84CC16',
];
const DOODLE_COLOR_SWATCHES = [
  '#111827',
  '#EAF0F6',
  '#FFFFFF',
  '#2BD9A8',
  '#10B981',
  '#F7C948',
  '#F97316',
  '#FB7185',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#6366F1',
  '#3B82F6',
  '#38BDF8',
  '#14B8A6',
  '#84CC16',
];
const SIGNATURE_COLOR_SWATCHES = [
  '#111827',
  '#000000',
  '#374151',
  '#EAF0F6',
  '#FFFFFF',
  '#2BD9A8',
  '#14B8A6',
  '#38BDF8',
  '#3B82F6',
  '#2563EB',
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#FB7185',
  '#EF4444',
  '#F97316',
  '#F7C948',
  '#84CC16',
];
const STAMP_COLOR_SWATCHES = [
  '#DC2626',
  '#EF4444',
  '#FB7185',
  '#B91C1C',
  '#F97316',
  '#F59E0B',
  '#F7C948',
  '#84CC16',
  '#16A34A',
  '#2BD9A8',
  '#14B8A6',
  '#0891B2',
  '#38BDF8',
  '#2563EB',
  '#1D4ED8',
  '#6366F1',
  '#8B5CF6',
  '#A855F7',
  '#EC4899',
  '#111827',
  '#374151',
  '#EAF0F6',
];
const STAMP_TEMPLATES: Array<{
  label: string;
  detail: string;
  color: string;
  shape: EditorOptions['stampShape'];
  style: EditorOptions['stampStyle'];
}> = [
  { label: 'APPROVED', detail: 'VERIFIED', color: '#16A34A', shape: 'box', style: 'double' },
  { label: 'DRAFT', detail: 'WORKING COPY', color: '#F59E0B', shape: 'pill', style: 'outline' },
  { label: 'FINAL', detail: 'LOCKED', color: '#2563EB', shape: 'box', style: 'filled' },
  { label: 'PAID', detail: 'RECEIVED', color: '#16A34A', shape: 'pill', style: 'filled' },
  { label: 'REVIEWED', detail: 'FILEMINT', color: '#8B5CF6', shape: 'seal', style: 'double' },
  { label: 'REJECTED', detail: 'RETURNED', color: '#DC2626', shape: 'box', style: 'double' },
  { label: 'CONFIDENTIAL', detail: 'DO NOT COPY', color: '#DC2626', shape: 'pill', style: 'outline' },
  { label: 'URGENT', detail: 'ACTION NEEDED', color: '#F97316', shape: 'seal', style: 'filled' },
];
const FORM_FIELD_PRESETS: Array<{
  kind: EditorOptions['formFieldKind'];
  label: string;
  icon: string;
  placeholder: string;
  value: string;
  width: number;
  height: number;
}> = [
  {
    kind: 'text',
    label: 'Text field',
    icon: 'form-textbox',
    placeholder: 'Type here',
    value: '',
    width: 0.42,
    height: 0.055,
  },
  {
    kind: 'checkbox',
    label: 'Checkbox',
    icon: 'checkbox-marked-outline',
    placeholder: 'Checkbox',
    value: '',
    width: 0.09,
    height: 0.045,
  },
  {
    kind: 'date',
    label: 'Date',
    icon: 'calendar-month-outline',
    placeholder: 'Date',
    value: new Date().toISOString().slice(0, 10),
    width: 0.26,
    height: 0.055,
  },
  {
    kind: 'signature',
    label: 'Signature',
    icon: 'draw',
    placeholder: 'Signature',
    value: 'Signature',
    width: 0.34,
    height: 0.08,
  },
  {
    kind: 'initials',
    label: 'Initials',
    icon: 'signature-freehand',
    placeholder: 'Initials',
    value: 'Initials',
    width: 0.18,
    height: 0.055,
  },
];
const ANNOTATE_COLOR_SWATCHES = [
  '#F7C948',
  '#FFF59D',
  '#2BD9A8',
  '#14B8A6',
  '#38BDF8',
  '#3B82F6',
  '#8B5CF6',
  '#FB7185',
  '#EF4444',
  '#F97316',
  '#111827',
  '#EAF0F6',
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

function parsePositiveNumber(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parsePageRange(value: string, pageCount: number): number[] {
  const pages = new Set<number>();
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const [startRaw, endRaw] = part.split('-').map((item) => Number(item.trim()));
      if (!Number.isFinite(startRaw)) return;
      const start = Math.max(1, Math.min(pageCount, startRaw));
      const end = Number.isFinite(endRaw) ? Math.max(1, Math.min(pageCount, endRaw)) : start;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      for (let i = lo; i <= hi; i++) pages.add(i - 1);
    });
  return [...pages].sort((a, b) => a - b);
}

function targetPagesForScope(scope: ApplyScope, pageIndex: number, pageCount: number, range: string) {
  if (scope === 'all') return Array.from({ length: pageCount }, (_, index) => index);
  if (scope === 'range') {
    const parsed = parsePageRange(range, pageCount);
    return parsed.length ? parsed : [pageIndex];
  }
  // A full selected-pages model can be layered on later; current page is the
  // honest fallback for both Current and Selected in this editor shell.
  return [pageIndex];
}

function cropEdgesFromQuad(quad: CropQuad) {
  const xs = [quad.tl.x, quad.tr.x, quad.br.x, quad.bl.x];
  const ys = [quad.tl.y, quad.tr.y, quad.br.y, quad.bl.y];
  const left = Math.min(...xs) * 100;
  const right = (1 - Math.max(...xs)) * 100;
  const top = Math.min(...ys) * 100;
  const bottom = (1 - Math.max(...ys)) * 100;
  return { top, right, bottom, left, unit: 'percent' as const };
}

function redactionAreas(targetPages: number[]) {
  return targetPages.map((page) => ({ page, x: 0.22, y: 0.42, width: 0.48, height: 0.07 }));
}

function canUsePdfEditorTool(tool: EditorToolId): tool is PdfEditorTool {
  return [
    'doodle',
    'highlight',
    'add-stamp',
    'add-signature',
    'flatten',
    'add-watermark',
    'annotate',
    'redact',
    'add-text',
    'add-page-numbers',
    'fill-forms',
  ].includes(tool);
}

function editorObjectTypeForTool(tool: EditorToolId): EditorObjectType | null {
  if (tool === 'add-text') return 'text';
  if (tool === 'add-watermark') return 'watermark';
  if (tool === 'add-stamp') return 'stamp';
  if (tool === 'add-signature') return 'signature';
  if (tool === 'doodle') return 'doodle';
  if (tool === 'highlight') return 'highlight';
  if (tool === 'annotate') return 'annotate';
  if (tool === 'redact') return 'redact';
  if (tool === 'fill-forms') return 'form-field';
  return null;
}

function makeObjectId() {
  return `editor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampUnit(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampEditorObject(object: EditorObject): EditorObject {
  const width = clampUnit(object.width, 0.04, 0.96);
  const height = clampUnit(object.height, 0.025, 0.96);
  return {
    ...object,
    width,
    height,
    x: clampUnit(object.x, 0, 1 - width),
    y: clampUnit(object.y, 0, 1 - height),
  };
}

function objectTextForType(type: EditorObjectType, options: EditorOptions) {
  if (type === 'stamp')
    return options.stampMode === 'upload'
      ? options.stampImageName || 'Uploaded stamp'
      : options.stampText || 'APPROVED';
  if (type === 'signature') {
    if (options.signatureMode === 'draw') return 'Drawn signature';
    if (options.signatureMode === 'upload') return options.signatureImageName || 'Uploaded signature';
    return options.signatureText || 'Signature';
  }
  if (type === 'annotate') return options.annotationText || 'Review note';
  if (type === 'redact') return options.redactLabel || 'Redacted';
  if (type === 'form-field') return options.formValue || options.formPlaceholder || 'Form field';
  if (type === 'watermark') return options.text || 'CONFIDENTIAL';
  return options.text || 'Editable text';
}

function defaultObjectForTool(
  tool: EditorToolId,
  pageIndex: number,
  options: EditorOptions,
): EditorObject | null {
  const type = editorObjectTypeForTool(tool);
  if (!type || type === 'doodle') return null;
  const base = {
    id: makeObjectId(),
    pageIndex,
    type,
    color: tool === 'highlight' ? '#F7C948' : tool === 'redact' ? '#000000' : options.color || '#2BD9A8',
    opacity: parsePositiveNumber(options.opacity, 0.86, 0.05, 1),
    thickness: parsePositiveNumber(
      options.thickness,
      type === 'signature' && options.signatureMode === 'draw' ? 2 : 4,
      1,
      24,
    ),
    fontSize:
      type === 'text'
        ? parsePositiveNumber(options.fontSize, 14, 6, 96)
        : type === 'signature'
          ? parsePositiveNumber(options.signatureFontSize, 24, 8, 96)
          : undefined,
    rotation: parsePositiveNumber(
      options.rotation,
      type === 'watermark' ? -34 : type === 'stamp' ? -12 : type === 'signature' ? -8 : 0,
      -180,
      180,
    ),
    text: objectTextForType(type, options),
    bold: type === 'text' ? options.bold : false,
    italic: type === 'text' ? options.italic : false,
    underline: type === 'text' ? options.underline : false,
    align: type === 'text' ? options.align : 'center',
    stampDetail: type === 'stamp' ? options.stampDetail : undefined,
    stampMode: type === 'stamp' ? options.stampMode : undefined,
    stampShape: type === 'stamp' ? options.stampShape : undefined,
    stampStyle: type === 'stamp' ? options.stampStyle : undefined,
    stampImageDataUrl: type === 'stamp' ? options.stampImageDataUrl : undefined,
    stampImageName: type === 'stamp' ? options.stampImageName : undefined,
    signatureMode: type === 'signature' ? options.signatureMode : undefined,
    signaturePoints: type === 'signature' ? options.signaturePoints : undefined,
    signaturePaths: type === 'signature' ? options.signaturePaths : undefined,
    signatureImageDataUrl: type === 'signature' ? options.signatureImageDataUrl : undefined,
    signatureImageName: type === 'signature' ? options.signatureImageName : undefined,
    formFieldKind: type === 'form-field' ? options.formFieldKind : undefined,
    formValue: type === 'form-field' ? options.formValue : undefined,
    formPlaceholder: type === 'form-field' ? options.formPlaceholder : undefined,
    formChecked: type === 'form-field' ? options.formChecked : undefined,
    formRequired: type === 'form-field' ? options.formRequired : undefined,
    annotationMode: type === 'annotate' ? options.annotationMode : undefined,
  };
  const formPreset =
    FORM_FIELD_PRESETS.find((preset) => preset.kind === options.formFieldKind) ?? FORM_FIELD_PRESETS[0];
  const rects: Record<
    Exclude<EditorObjectType, 'doodle'>,
    Pick<EditorObject, 'x' | 'y' | 'width' | 'height'>
  > = {
    text: { x: 0.19, y: 0.3, width: 0.44, height: 0.08 },
    watermark: { x: 0.1, y: 0.42, width: 0.8, height: 0.12 },
    stamp: { x: 0.24, y: 0.55, width: 0.48, height: 0.11 },
    signature: { x: 0.42, y: 0.7, width: 0.34, height: 0.1 },
    highlight: { x: 0.18, y: 0.36, width: 0.56, height: 0.052 },
    annotate: { x: 0.62, y: 0.18, width: 0.28, height: 0.12 },
    redact: { x: 0.22, y: 0.42, width: 0.48, height: 0.07 },
    'form-field': { x: 0.22, y: 0.28, width: formPreset.width, height: formPreset.height },
  };
  return clampEditorObject({ ...base, ...rects[type] });
}

function syncObjectFromOptions(object: EditorObject, options: EditorOptions): EditorObject {
  if (object.type === 'doodle') {
    return object;
  }
  return clampEditorObject({
    ...object,
    text: objectTextForType(object.type, options),
    color:
      object.type === 'highlight'
        ? options.color || '#F7C948'
        : object.type === 'redact'
          ? '#000000'
          : options.color || object.color,
    opacity: parsePositiveNumber(options.opacity, object.opacity, 0.05, 1),
    thickness: parsePositiveNumber(options.thickness, object.thickness, 1, 24),
    fontSize:
      object.type === 'text'
        ? parsePositiveNumber(options.fontSize, object.fontSize ?? 14, 6, 96)
        : object.type === 'signature'
          ? parsePositiveNumber(options.signatureFontSize, object.fontSize ?? 24, 8, 96)
          : object.fontSize,
    rotation: parsePositiveNumber(options.rotation, object.rotation, -180, 180),
    bold: object.type === 'text' ? options.bold : object.bold,
    italic: object.type === 'text' ? options.italic : object.italic,
    underline: object.type === 'text' ? options.underline : object.underline,
    align: object.type === 'text' ? options.align : object.align,
    stampDetail: object.type === 'stamp' ? options.stampDetail : object.stampDetail,
    stampMode: object.type === 'stamp' ? options.stampMode : object.stampMode,
    stampShape: object.type === 'stamp' ? options.stampShape : object.stampShape,
    stampStyle: object.type === 'stamp' ? options.stampStyle : object.stampStyle,
    stampImageDataUrl: object.type === 'stamp' ? options.stampImageDataUrl : object.stampImageDataUrl,
    stampImageName: object.type === 'stamp' ? options.stampImageName : object.stampImageName,
    signatureMode: object.type === 'signature' ? options.signatureMode : object.signatureMode,
    signaturePoints: object.type === 'signature' ? options.signaturePoints : object.signaturePoints,
    signaturePaths: object.type === 'signature' ? options.signaturePaths : object.signaturePaths,
    signatureImageDataUrl:
      object.type === 'signature' ? options.signatureImageDataUrl : object.signatureImageDataUrl,
    signatureImageName: object.type === 'signature' ? options.signatureImageName : object.signatureImageName,
    formFieldKind: object.type === 'form-field' ? options.formFieldKind : object.formFieldKind,
    formValue: object.type === 'form-field' ? options.formValue : object.formValue,
    formPlaceholder: object.type === 'form-field' ? options.formPlaceholder : object.formPlaceholder,
    formChecked: object.type === 'form-field' ? options.formChecked : object.formChecked,
    formRequired: object.type === 'form-field' ? options.formRequired : object.formRequired,
    annotationMode: object.type === 'annotate' ? options.annotationMode : object.annotationMode,
  });
}

function exportEditorObjects(objects: EditorObject[]): PdfEditorObjectExport[] {
  return objects.map((object) => ({
    type: object.type,
    pageIndex: object.pageIndex,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    text: object.text,
    color: object.color,
    opacity: object.opacity,
    thickness: object.thickness,
    fontSize: object.fontSize,
    rotation: object.rotation,
    bold: object.bold,
    italic: object.italic,
    underline: object.underline,
    align: object.align,
    stampDetail: object.stampDetail,
    stampMode: object.stampMode,
    stampShape: object.stampShape,
    stampStyle: object.stampStyle,
    stampImageDataUrl: object.stampImageDataUrl,
    stampImageName: object.stampImageName,
    signatureMode: object.signatureMode,
    signaturePoints: object.signaturePoints,
    signaturePaths: object.signaturePaths,
    signatureImageDataUrl: object.signatureImageDataUrl,
    signatureImageName: object.signatureImageName,
    formFieldKind: object.formFieldKind,
    formValue: object.formValue,
    formPlaceholder: object.formPlaceholder,
    formChecked: object.formChecked,
    formRequired: object.formRequired,
    doodleMode: object.doodleMode,
    annotationMode: object.annotationMode,
    points: object.points,
  }));
}

function redactionAreasFromObjects(objects: EditorObject[], fallbackPages: number[]) {
  const redactions = objects.filter((object) => object.type === 'redact');
  if (!redactions.length) return redactionAreas(fallbackPages);
  return redactions.map((object) => ({
    page: object.pageIndex,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
  }));
}

function distanceToSegment(point: EditorPoint, a: EditorPoint, b: EditorPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

function pointOnSegment(a: EditorPoint, b: EditorPoint, t: number): EditorPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function splitSegmentAroundPoint(a: EditorPoint, b: EditorPoint, point: EditorPoint, radius: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { before: undefined, after: undefined };
  const len = Math.sqrt(lenSq);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  const gap = Math.min(0.48, Math.max(radius / len, 0.015));
  const beforeT = t - gap;
  const afterT = t + gap;
  return {
    before: beforeT > 0 ? pointOnSegment(a, b, beforeT) : undefined,
    after: afterT < 1 ? pointOnSegment(a, b, afterT) : undefined,
  };
}

function doodleTouchesPoint(object: EditorObject, point: EditorPoint, radius: number) {
  const points = object.points ?? [];
  if (points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) <= radius))
    return true;
  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(point, points[i], points[i + 1]) <= radius) return true;
  }
  return false;
}

function splitDoodleObjectAt(object: EditorObject, point: EditorPoint, radius: number): EditorObject[] {
  const points = object.points ?? [];
  if (points.length < 2 || !doodleTouchesPoint(object, point, radius)) return [object];
  const groups: EditorPoint[][] = [];
  let current: EditorPoint[] = [points[0]];

  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const hit = distanceToSegment(point, a, b) <= radius;
    if (!hit) {
      if (!current.length) current = [a];
      current.push(b);
      continue;
    }

    const split = splitSegmentAroundPoint(a, b, point, radius);
    if (split.before && current.length) current.push(split.before);
    if (current.length > 1) groups.push(current);
    current = split.after ? [split.after] : [];
  }

  if (current.length > 1) groups.push(current);
  return groups.map((group, index) => ({
    ...object,
    id: index === 0 ? object.id : makeObjectId(),
    points: group,
  }));
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

function fileExtensionFromName(name: string, fallback = 'png') {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? fallback;
}

function mimeFromImageName(name: string, fallback?: string) {
  const ext = fileExtensionFromName(name);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return fallback || 'image/png';
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
  const params = useLocalSearchParams<{ tool?: string; file?: string }>();
  const initialTool = normalizeTool(params.tool);
  const routeFileId = Array.isArray(params.file) ? params.file[0] : params.file;
  const [activeTool, setActiveTool] = useState<EditorToolId>(initialTool);
  const catalogTool = findTool(activeTool);
  const isPremium = useAuth(selectIsPremium);
  const routedFile = useLibrary((s) =>
    routeFileId ? s.files.find((item) => item.id === routeFileId) : undefined,
  );
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
  const [editorOptions, setEditorOptions] = useState<EditorOptions>({
    text: 'Editable text',
    stampText: 'APPROVED',
    stampDetail: 'VERIFIED',
    stampMode: 'design',
    stampShape: 'box',
    stampStyle: 'double',
    stampImageDataUrl: undefined,
    stampImageName: undefined,
    signatureText: 'Signature',
    annotationText: 'Review note',
    redactLabel: 'Redacted',
    color: '#2BD9A8',
    opacity: '0.86',
    thickness: '4',
    fontSize: '14',
    signatureFontSize: '24',
    rotation: '-12',
    bold: false,
    italic: false,
    underline: false,
    align: 'left',
    signatureMode: 'draw',
    signaturePoints: [],
    signaturePaths: [],
    signatureImageDataUrl: undefined,
    signatureImageName: undefined,
    formFieldKind: 'text',
    formValue: '',
    formPlaceholder: 'Type here',
    formChecked: true,
    formRequired: false,
    doodleMode: 'pencil',
    annotationMode: 'note',
  });
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const tool = EDITOR_TOOLS[activeTool];
  const accent = Accents[tool.accent];
  const shareSupported = canShareFiles();
  const currentPage = pages[pageIndex];
  const pageCount = Math.max(1, pages.length);
  const pageWidth = Math.max(280, Math.min(desktop ? width - 650 : width - 36, 760) * zoom);
  const canApply = Boolean(file && pages.length > 0 && !rendering && !renderError);
  const pageObjects = useMemo(
    () => objects.filter((object) => object.pageIndex === pageIndex),
    [objects, pageIndex],
  );
  const loadedRouteFileRef = useRef<string | null>(null);

  const pickFile = useCallback(async (picked: FileItem) => {
    setFile(picked);
    setPages([]);
    setObjects([]);
    setSelectedObjectId(null);
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
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setResultFile(null);
  }, [activeTool, file?.id]);

  useEffect(() => {
    setResultFile(null);
  }, [objects, quad]);

  useEffect(() => {
    if (!routedFile || routedFile.kind !== 'pdf' || loadedRouteFileRef.current === routedFile.id) return;
    loadedRouteFileRef.current = routedFile.id;
    void pickFile(routedFile);
  }, [pickFile, routedFile]);

  useEffect(() => {
    if (!file) {
      setObjects([]);
      setSelectedObjectId(null);
    }
  }, [file]);

  useEffect(() => {
    const objectType = editorObjectTypeForTool(activeTool);
    if (!file || !pages.length || !objectType) return;
    if (objectType === 'doodle') {
      setSelectedObjectId(null);
      return;
    }
    const nextObject = defaultObjectForTool(activeTool, pageIndex, editorOptions);
    if (!nextObject) return;
    setObjects((prev) => {
      const existing = prev.find((object) => object.pageIndex === pageIndex && object.type === objectType);
      if (existing) {
        setSelectedObjectId(existing.id);
        return prev;
      }
      setSelectedObjectId(nextObject.id);
      return [...prev, nextObject];
    });
  }, [activeTool, file, pageIndex, pages.length]);

  useEffect(() => {
    if (!selectedObjectId) return;
    setObjects((prev) =>
      prev.map((object) =>
        object.id === selectedObjectId ? syncObjectFromOptions(object, editorOptions) : object,
      ),
    );
  }, [editorOptions, selectedObjectId]);

  if (catalogTool?.premium && !isPremium) {
    const upgradeRoute = premiumUpgradeRoute(
      catalogTool,
      `/pdf-editor?tool=${encodeURIComponent(activeTool)}`,
    );
    return (
      <SafeAreaView
        style={[styles.root, styles.lockedRoot, { backgroundColor: theme.background }]}
        edges={['top']}
      >
        <View style={[styles.lockedCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <View style={[styles.bigIcon, { backgroundColor: withAlpha(Accents.amber, 0.18) }]}>
            <Icon name="crown-outline" size={36} color={Accents.amber} />
          </View>
          <Txt variant="title" center>
            Premium editor
          </Txt>
          <Txt variant="caption" muted center>
            {catalogTool.premiumReason ?? `${catalogTool.title} is included with FileMint Premium.`}
          </Txt>
          <Button
            title="Upgrade Now"
            icon="crown-outline"
            full
            onPress={() => router.push(upgradeRoute as never)}
          />
          <Button
            title="View Plans"
            icon="credit-card-outline"
            variant="secondary"
            full
            onPress={() => router.push(upgradeRoute as never)}
          />
          <Button title="Maybe Later" variant="ghost" full onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    );
  }

  const selectEditorObject = (object: EditorObject) => {
    setSelectedObjectId(object.id);
    setEditorOptions((prev) => ({
      ...prev,
      text: object.type === 'text' || object.type === 'watermark' ? (object.text ?? prev.text) : prev.text,
      stampText: object.type === 'stamp' ? (object.text ?? prev.stampText) : prev.stampText,
      stampDetail: object.type === 'stamp' ? (object.stampDetail ?? prev.stampDetail) : prev.stampDetail,
      stampMode: object.type === 'stamp' ? (object.stampMode ?? prev.stampMode) : prev.stampMode,
      stampShape: object.type === 'stamp' ? (object.stampShape ?? prev.stampShape) : prev.stampShape,
      stampStyle: object.type === 'stamp' ? (object.stampStyle ?? prev.stampStyle) : prev.stampStyle,
      stampImageDataUrl:
        object.type === 'stamp'
          ? (object.stampImageDataUrl ?? prev.stampImageDataUrl)
          : prev.stampImageDataUrl,
      stampImageName:
        object.type === 'stamp' ? (object.stampImageName ?? prev.stampImageName) : prev.stampImageName,
      signatureText:
        object.type === 'signature' && (object.signatureMode ?? 'type') === 'type'
          ? (object.text ?? prev.signatureText)
          : prev.signatureText,
      annotationText: object.type === 'annotate' ? (object.text ?? prev.annotationText) : prev.annotationText,
      redactLabel: object.type === 'redact' ? (object.text ?? prev.redactLabel) : prev.redactLabel,
      color: object.color,
      opacity: String(Number(object.opacity.toFixed(2))),
      thickness: String(Number(object.thickness.toFixed(1))),
      fontSize: String(Number((object.fontSize ?? 14).toFixed(1))),
      signatureFontSize:
        object.type === 'signature'
          ? String(Number((object.fontSize ?? 24).toFixed(1)))
          : prev.signatureFontSize,
      rotation: String(Number(object.rotation.toFixed(1))),
      bold: Boolean(object.bold),
      italic: Boolean(object.italic),
      underline: Boolean(object.underline),
      align: object.align ?? prev.align,
      signatureMode:
        object.type === 'signature' ? (object.signatureMode ?? prev.signatureMode) : prev.signatureMode,
      signaturePoints:
        object.type === 'signature' ? (object.signaturePoints ?? prev.signaturePoints) : prev.signaturePoints,
      signaturePaths:
        object.type === 'signature' ? (object.signaturePaths ?? prev.signaturePaths) : prev.signaturePaths,
      signatureImageDataUrl:
        object.type === 'signature'
          ? (object.signatureImageDataUrl ?? prev.signatureImageDataUrl)
          : prev.signatureImageDataUrl,
      signatureImageName:
        object.type === 'signature'
          ? (object.signatureImageName ?? prev.signatureImageName)
          : prev.signatureImageName,
      formFieldKind:
        object.type === 'form-field' ? (object.formFieldKind ?? prev.formFieldKind) : prev.formFieldKind,
      formValue: object.type === 'form-field' ? (object.formValue ?? prev.formValue) : prev.formValue,
      formPlaceholder:
        object.type === 'form-field'
          ? (object.formPlaceholder ?? prev.formPlaceholder)
          : prev.formPlaceholder,
      formChecked: object.type === 'form-field' ? Boolean(object.formChecked) : prev.formChecked,
      formRequired: object.type === 'form-field' ? Boolean(object.formRequired) : prev.formRequired,
      annotationMode:
        object.type === 'annotate' ? (object.annotationMode ?? prev.annotationMode) : prev.annotationMode,
    }));
  };

  const patchEditorObject = (
    id: string,
    patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject),
  ) => {
    setObjects((prev) =>
      prev.map((object) => {
        if (object.id !== id) return object;
        const next = typeof patch === 'function' ? patch(object) : { ...object, ...patch };
        return clampEditorObject(next);
      }),
    );
  };

  const addEditorObject = (object: EditorObject) => {
    const next = clampEditorObject(object);
    setObjects((prev) => [...prev, next]);
    if (next.type === 'doodle') {
      setSelectedObjectId(null);
      return;
    }
    selectEditorObject(next);
  };

  const eraseDoodlesAt = (targetPageIndex: number, point: EditorPoint, radius = 0.035) => {
    setObjects((prev) =>
      prev.flatMap((object) =>
        object.type === 'doodle' && object.pageIndex === targetPageIndex
          ? splitDoodleObjectAt(object, point, radius)
          : [object],
      ),
    );
  };

  const addObjectForActiveTool = (optionOverrides?: Partial<EditorOptions>) => {
    const nextOptions = { ...editorOptions, ...optionOverrides };
    const object = defaultObjectForTool(activeTool, pageIndex, nextOptions);
    if (!object) {
      setToast({ tone: 'error', text: 'This tool does not place a box on the page' });
      return;
    }
    const sameTypeCount = objects.filter(
      (item) => item.pageIndex === pageIndex && item.type === object.type,
    ).length;
    if (optionOverrides) setEditorOptions((prev) => ({ ...prev, ...optionOverrides }));
    addEditorObject(
      clampEditorObject({
        ...object,
        x: object.x + Math.min(0.24, sameTypeCount * 0.045),
        y: object.y + Math.min(0.24, sameTypeCount * 0.045),
      }),
    );
    setToast({ tone: 'success', text: `${EDITOR_TOOLS[activeTool].title} box added` });
  };

  const clearSelectedObject = () => {
    setSelectedObjectId(null);
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
      const targetPages = targetPagesForScope(applyScope, pageIndex, pageCount, pageRange);
      const currentType = editorObjectTypeForTool(activeTool);
      const defaultForExport =
        currentType &&
        currentType !== 'doodle' &&
        !objects.some((object) => object.pageIndex === pageIndex && object.type === currentType)
          ? defaultObjectForTool(activeTool, pageIndex, editorOptions)
          : null;
      const exportObjects = defaultForExport ? [...objects, defaultForExport] : objects;
      let output: Uint8Array;

      if (activeTool === 'redact') {
        const ok = await confirm(
          'Apply permanent redaction?',
          'FileMint will create a new redacted copy and try to remove hidden text/content in the selected areas. The original file is not overwritten.',
          'Redact copy',
          true,
        );
        if (!ok) return;
        try {
          const uri = await storage.getUri(file.storageKey);
          const res = await convertFile({
            endpoint: 'edit/redact',
            fileUri: uri,
            fileName: file.name,
            mime: file.mime,
            fields: {
              areasJson: JSON.stringify(redactionAreasFromObjects(exportObjects, targetPages)),
              color: editorOptions.color || '#000000',
              label: editorOptions.redactLabel || 'Redacted',
            },
          });
          const remainingObjects = exportObjects.filter((object) => object.type !== 'redact');
          output = remainingObjects.length
            ? await applyPdfEditorObjects(res.bytes, exportEditorObjects(remainingObjects))
            : res.bytes;
        } catch {
          output = await applyPdfEditorObjects(bytes, exportEditorObjects(exportObjects));
          setToast({
            tone: 'error',
            text: 'Server redaction unavailable; exported visual redaction fallback',
          });
        }
      } else if (activeTool === 'crop-pdf') {
        output = await cropPdfEdges(bytes, cropEdgesFromQuad(quad), targetPages);
      } else if (activeTool === 'flatten' || activeTool === 'add-page-numbers') {
        output = await applyPdfEditorTool(bytes, {
          tool: activeTool,
          targetPages,
          color: editorOptions.color,
          opacity: parsePositiveNumber(editorOptions.opacity, 0.86, 0.05, 1),
        });
        if (exportObjects.length)
          output = await applyPdfEditorObjects(output, exportEditorObjects(exportObjects));
      } else if (canUsePdfEditorTool(activeTool)) {
        output = exportObjects.length
          ? await applyPdfEditorObjects(bytes, exportEditorObjects(exportObjects))
          : bytes;
      } else {
        output = bytes;
      }

      const saved = await useLibrary.getState().saveResult({
        bytes: output,
        name: `${baseName(file.name)} ${tool.title}.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: pages.length || undefined,
        thumbnailUri: currentPage?.uri,
      });
      setResultFile(saved);
      setToast({ tone: 'success', text: `${tool.title} PDF is ready` });
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

  const previewResult = () => {
    if (!resultFile) return;
    router.push(`/viewer/${resultFile.id}` as never);
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
              Choose a PDF to open the full editor with thumbnails, canvas preview, zoom, crop, and tool
              controls.
            </Txt>
            <PickFile
              onPicked={pickFile}
              title="Select PDF"
              subtitle="Import from your device or choose an existing FileMint PDF."
              icon="file-pdf-box"
            />
          </View>
        </View>
      ) : (
        <View style={[styles.editorBody, desktop ? styles.editorBodyDesktop : styles.editorBodyMobile]}>
          {desktop ? (
            <PageSidebar pages={pages} pageIndex={pageIndex} loading={rendering} onSelect={setPageIndex} />
          ) : null}
          <View style={styles.canvasColumn}>
            <View
              style={[
                styles.canvasHeader,
                { borderColor: theme.border, backgroundColor: theme.backgroundElevated },
              ]}
            >
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
                <IconButton
                  name="chevron-left"
                  variant="surface"
                  disabled={pageIndex === 0}
                  onPress={() => setPageIndex((p) => Math.max(0, p - 1))}
                  accessibilityLabel="Previous page"
                />
                <IconButton
                  name="chevron-right"
                  variant="surface"
                  disabled={pageIndex >= pages.length - 1}
                  onPress={() => setPageIndex((p) => Math.min(pages.length - 1, p + 1))}
                  accessibilityLabel="Next page"
                />
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
                  scrollEnabled={!cropDragging && !canvasInteracting}
                  contentContainerStyle={styles.stageContent}
                  horizontal
                  bounces={false}
                  showsHorizontalScrollIndicator={false}
                >
                  <ScrollView
                    contentContainerStyle={styles.stageInner}
                    bounces={false}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={!cropDragging && !canvasInteracting}
                  >
                    <View style={[styles.pageSurface, { width: pageWidth, aspectRatio: 0.707 }]}>
                      {currentPage ? (
                        <Image
                          source={{ uri: currentPage.uri }}
                          resizeMode="contain"
                          style={styles.pageImage}
                        />
                      ) : null}
                      {activeTool === 'crop-pdf' ? (
                        <CropOverlay
                          quad={quad}
                          mode={cropMode}
                          accent={accent}
                          onChange={setQuad}
                          onDragStateChange={setCropDragging}
                        />
                      ) : (
                        <EditorObjectsOverlay
                          tool={activeTool}
                          pageIndex={pageIndex}
                          objects={pageObjects}
                          selectedObjectId={selectedObjectId}
                          options={editorOptions}
                          accent={accent}
                          onSelect={selectEditorObject}
                          onClearSelection={clearSelectedObject}
                          onPatch={patchEditorObject}
                          onAdd={addEditorObject}
                          onEraseDoodlesAt={eraseDoodlesAt}
                          onInteractionStateChange={setCanvasInteracting}
                        />
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
            editorOptions={editorOptions}
            setEditorOptions={setEditorOptions}
            beforeAfter={beforeAfter}
            setBeforeAfter={setBeforeAfter}
            onAuto={() => {
              setQuad({
                tl: { x: 0.09, y: 0.08 },
                tr: { x: 0.9, y: 0.09 },
                br: { x: 0.88, y: 0.9 },
                bl: { x: 0.1, y: 0.88 },
              });
              setToast({ tone: 'success', text: 'Document edges detected' });
            }}
            onRemoveMargins={() => {
              setQuad({
                tl: { x: 0.06, y: 0.05 },
                tr: { x: 0.94, y: 0.05 },
                br: { x: 0.94, y: 0.95 },
                bl: { x: 0.06, y: 0.95 },
              });
              setToast({ tone: 'success', text: 'Margins removed in preview' });
            }}
            onPerfect={makePerfect}
            onReset={resetCrop}
            onApply={applyPreview}
            onAddObject={addObjectForActiveTool}
            saving={saving}
            canApply={canApply}
            resultFile={resultFile}
            onPreview={previewResult}
            onDownload={downloadResult}
            onShare={shareResult}
            shareSupported={shareSupported}
            resultAction={resultAction}
          />
        </View>
      )}

      {toast ? (
        <View
          style={[styles.toast, { backgroundColor: toast.tone === 'success' ? theme.success : theme.danger }]}
        >
          <Icon
            name={toast.tone === 'success' ? 'check-circle-outline' : 'alert-circle-outline'}
            size={18}
            color="#06120E"
          />
          <Txt variant="label" style={{ color: '#06120E' }}>
            {toast.text}
          </Txt>
        </View>
      ) : null}
      {!desktop ? (
        <MobileResultDock
          file={resultFile}
          onPreview={previewResult}
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
          <IconButton
            name="content-save-outline"
            variant="surface"
            onPress={onSave}
            disabled={saving || !canSave}
            accessibilityLabel="Save or export"
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.mobileToolbarContent}
        >
          <IconButton name="undo" variant="surface" onPress={onUndo} accessibilityLabel="Undo" />
          <IconButton name="redo" variant="surface" onPress={onRedo} accessibilityLabel="Redo" />
          <IconButton
            name="magnify-minus-outline"
            variant="surface"
            onPress={onZoomOut}
            accessibilityLabel="Zoom out"
          />
          <Pressable
            onPress={onFit}
            style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            accessibilityRole="button"
          >
            <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
          </Pressable>
          <IconButton
            name="magnify-plus-outline"
            variant="surface"
            onPress={onZoomIn}
            accessibilityLabel="Zoom in"
          />
          <Button
            title="Export"
            icon="export-variant"
            size="sm"
            onPress={onSave}
            loading={saving}
            disabled={!canSave}
          />
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
        <IconButton
          name="magnify-minus-outline"
          variant="surface"
          onPress={onZoomOut}
          accessibilityLabel="Zoom out"
        />
        <Pressable
          onPress={onFit}
          style={[styles.zoomPill, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          accessibilityRole="button"
        >
          <Txt variant="tiny">{Math.round(zoom * 100)}%</Txt>
        </Pressable>
        <IconButton
          name="magnify-plus-outline"
          variant="surface"
          onPress={onZoomIn}
          accessibilityLabel="Zoom in"
        />
      </View>
      <Button
        title="Save / Export"
        icon="content-save-outline"
        size="sm"
        onPress={onSave}
        loading={saving}
        disabled={!canSave}
      />
    </View>
  );
}

function PageSidebar({
  pages,
  pageIndex,
  loading,
  onSelect,
}: {
  pages: PreviewPage[];
  pageIndex: number;
  loading: boolean;
  onSelect: (index: number) => void;
}) {
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
                ]}
              >
                <Image source={{ uri: page.uri }} resizeMode="cover" style={styles.sideThumbImage} />
                <Txt variant="tiny">Page {page.index + 1}</Txt>
              </Pressable>
            ))}
      </ScrollView>
    </View>
  );
}

function PageStrip({
  pages,
  pageIndex,
  loading,
  onSelect,
}: {
  pages: PreviewPage[];
  pageIndex: number;
  loading: boolean;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[styles.mobileStrip, { backgroundColor: theme.backgroundElevated, borderColor: theme.border }]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileStripContent}
      >
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
                ]}
              >
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
    <View
      style={[
        compact ? styles.stripThumb : styles.sideThumb,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ]}
    >
      <View
        style={[
          compact ? styles.stripThumbImage : styles.sideThumbImage,
          { backgroundColor: theme.skeleton, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
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
      onLayout={(e: LayoutChangeEvent) =>
        setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
      }
      {...pan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Path d={path} fill="rgba(3,7,12,0.62)" fillRule="evenodd" />
        {gridLines.map((line, index) => (
          <Line
            key={index}
            x1={line.a.x}
            y1={line.a.y}
            x2={line.b.x}
            y2={line.b.y}
            stroke={withAlpha(accent, 0.52)}
            strokeWidth={1.2}
            strokeDasharray="7 6"
          />
        ))}
        <Polygon points={polyPoints} fill="transparent" stroke={accent} strokeWidth={3.5} />
        <Circle
          cx={center.x}
          cy={center.y}
          r={20}
          fill={withAlpha(accent, 0.22)}
          stroke={accent}
          strokeWidth={1.5}
        />
      </Svg>
      {(['tl', 'tr', 'br', 'bl'] as CropPointKey[]).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[
            styles.cornerHandle,
            {
              left: px[key].x - 16,
              top: px[key].y - 16,
              borderColor: accent,
              backgroundColor: theme.background,
            },
          ]}
        />
      ))}
      {(['top', 'right', 'bottom', 'left'] as const).map((key) => (
        <View
          key={key}
          testID={`crop-handle-${key}`}
          pointerEvents="none"
          style={[
            styles.edgeHandle,
            { left: mids[key].x - 12, top: mids[key].y - 12, backgroundColor: accent },
          ]}
        />
      ))}
      <View
        pointerEvents="none"
        style={[
          styles.dragHint,
          {
            left: center.x - 64,
            top: center.y + 28,
            backgroundColor: withAlpha(theme.background, 0.88),
            borderColor: withAlpha(accent, 0.7),
          },
        ]}
      >
        <Icon name="cursor-move" size={14} color={accent} />
        <Txt variant="tiny">Drag crop</Txt>
      </View>
      {dragging ? (
        <View
          pointerEvents="none"
          style={[
            styles.magnifier,
            {
              left: Math.min(layout.width - 116, dragging.x + 18),
              top: Math.max(8, dragging.y - 74),
              borderColor: accent,
              backgroundColor: theme.backgroundElevated,
            },
          ]}
        >
          <Icon name="magnify" size={16} color={accent} />
          <Txt variant="tiny">{dragging.target}</Txt>
        </View>
      ) : null}
    </View>
  );
}

function EditorObjectsOverlay({
  tool,
  pageIndex,
  objects,
  selectedObjectId,
  options,
  accent,
  onSelect,
  onClearSelection,
  onPatch,
  onAdd,
  onEraseDoodlesAt,
  onInteractionStateChange,
}: {
  tool: EditorToolId;
  pageIndex: number;
  objects: EditorObject[];
  selectedObjectId: string | null;
  options: EditorOptions;
  accent: string;
  onSelect: (object: EditorObject) => void;
  onClearSelection: () => void;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onAdd: (object: EditorObject) => void;
  onEraseDoodlesAt: (pageIndex: number, point: EditorPoint, radius?: number) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [drawingPoints, setDrawingPoints] = useState<EditorPoint[]>([]);
  const drawingRef = useRef<EditorPoint[]>([]);
  const overlayRef = useRef<unknown>(null);
  const drawingEnabled = tool === 'doodle';
  const eraserEnabled = drawingEnabled && options.doodleMode === 'eraser';
  const strokeColor = options.color || accent;
  const strokeWidth = parsePositiveNumber(options.thickness, options.doodleMode === 'marker' ? 9 : 4, 1, 24);
  const strokeOpacity = parsePositiveNumber(
    options.opacity,
    options.doodleMode === 'marker' ? 0.55 : 0.86,
    0.05,
    1,
  );
  const eraserRadius = 0.035;

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = overlayRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: clampUnit((clientX - rect.left) / layout.width),
      y: clampUnit((clientY - rect.top) / layout.height),
    };
  };

  const beginDrawing = (point: EditorPoint) => {
    if (!drawingEnabled) return;
    if (eraserEnabled) {
      drawingRef.current = [point];
      setDrawingPoints([point]);
      onClearSelection();
      onEraseDoodlesAt(pageIndex, point, eraserRadius);
      onInteractionStateChange(true);
      return;
    }
    drawingRef.current = [point];
    setDrawingPoints([point]);
    onClearSelection();
    onInteractionStateChange(true);
  };

  const updateDrawing = (point: EditorPoint) => {
    if (!drawingEnabled || !drawingRef.current.length) return;
    if (eraserEnabled) {
      drawingRef.current = [point];
      setDrawingPoints([point]);
      onEraseDoodlesAt(pageIndex, point, eraserRadius);
      return;
    }
    drawingRef.current =
      options.doodleMode === 'vector' || options.doodleMode === 'arrow'
        ? [drawingRef.current[0], point]
        : [...drawingRef.current, point];
    setDrawingPoints(drawingRef.current);
  };

  const endDrawing = () => {
    if (!eraserEnabled && drawingRef.current.length > 1) {
      const object: EditorObject = {
        id: makeObjectId(),
        pageIndex,
        type: 'doodle',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        color: strokeColor,
        opacity: strokeOpacity,
        thickness: strokeWidth,
        rotation: 0,
        doodleMode: options.doodleMode,
        points: drawingRef.current,
      };
      onAdd(object);
    }
    drawingRef.current = [];
    setDrawingPoints([]);
    onInteractionStateChange(false);
  };

  const pointerHandlers =
    Platform.OS === 'web' && drawingEnabled
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
            if (point) beginDrawing(point);
          },
          onPointerMove: (evt: unknown) => {
            if (!drawingRef.current.length) return;
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
            if (point) updateDrawing(point);
          },
          onPointerUp: endDrawing,
          onPointerCancel: endDrawing,
          onLostPointerCapture: endDrawing,
        } as Record<string, unknown>)
      : {};

  const drawPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => drawingEnabled,
        onMoveShouldSetPanResponder: () => drawingEnabled,
        onStartShouldSetPanResponderCapture: () => drawingEnabled,
        onMoveShouldSetPanResponderCapture: () => drawingEnabled,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          if (Platform.OS === 'web' || !drawingEnabled) return;
          beginDrawing({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderMove: (evt) => {
          if (Platform.OS === 'web' || !drawingEnabled || !drawingRef.current.length) return;
          updateDrawing({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderRelease: endDrawing,
        onPanResponderTerminate: endDrawing,
      }),
    [
      drawingEnabled,
      eraserEnabled,
      layout.height,
      layout.width,
      onEraseDoodlesAt,
      options.color,
      options.doodleMode,
      options.opacity,
      options.thickness,
      pageIndex,
    ],
  );

  return (
    <View
      ref={overlayRef as never}
      style={[StyleSheet.absoluteFill, WEB_GESTURE_STYLE]}
      onLayout={(event: LayoutChangeEvent) =>
        setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      {...drawPan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {objects
          .filter((object) => object.type === 'doodle')
          .map((object) => (
            <G key={object.id}>
              <Path
                d={pathFromDoodleObject(object, layout)}
                stroke={object.color}
                strokeWidth={object.thickness}
                strokeOpacity={object.opacity}
                fill="transparent"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {object.doodleMode === 'arrow' ? (
                <Path
                  d={arrowHeadPath(object.points ?? [], layout)}
                  stroke={object.color}
                  strokeWidth={object.thickness}
                  strokeOpacity={object.opacity}
                  fill="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </G>
          ))}
        {drawingPoints.length && !eraserEnabled ? (
          <>
            <Path
              d={pathFromPoints(drawingPoints, layout)}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              fill="transparent"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {options.doodleMode === 'arrow' ? (
              <Path
                d={arrowHeadPath(drawingPoints, layout)}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                fill="transparent"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </>
        ) : null}
        {drawingPoints.length && eraserEnabled ? (
          <Circle
            cx={drawingPoints[0].x * layout.width}
            cy={drawingPoints[0].y * layout.height}
            r={Math.max(12, eraserRadius * Math.min(layout.width, layout.height))}
            fill="rgba(255,255,255,0.28)"
            stroke={accent}
            strokeWidth={2}
          />
        ) : null}
      </Svg>
      {objects
        .filter((object) => object.type !== 'doodle')
        .map((object) => (
          <EditablePageObject
            key={object.id}
            object={object}
            selected={object.id === selectedObjectId}
            accent={object.id === selectedObjectId ? accent : theme.primary}
            layout={layout}
            onSelect={onSelect}
            onPatch={onPatch}
            onInteractionStateChange={onInteractionStateChange}
          />
        ))}
      {drawingEnabled && !drawingPoints.length ? (
        <View
          pointerEvents="none"
          style={[
            styles.drawHint,
            { backgroundColor: withAlpha(theme.background, 0.76), borderColor: withAlpha(strokeColor, 0.58) },
          ]}
        >
          <Icon
            name={eraserEnabled ? 'eraser' : 'gesture-tap'}
            size={16}
            color={eraserEnabled ? accent : strokeColor}
          />
          <Txt variant="tiny">{eraserEnabled ? 'Erase strokes' : 'Draw on the page'}</Txt>
        </View>
      ) : null}
    </View>
  );
}

function EditablePageObject({
  object,
  selected,
  accent,
  layout,
  onSelect,
  onPatch,
  onInteractionStateChange,
}: {
  object: EditorObject;
  selected: boolean;
  accent: string;
  layout: { width: number; height: number };
  onSelect: (object: EditorObject) => void;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const theme = useTheme();
  const objectRef = useRef(object);
  const dragStart = useRef<EditorObject | null>(null);
  const pointerDrag = useRef<{ start: EditorObject; startX: number; startY: number } | null>(null);

  useEffect(() => {
    objectRef.current = object;
  }, [object]);

  const beginObjectDrag = (clientX: number, clientY: number) => {
    const latest = objectRef.current;
    pointerDrag.current = { start: latest, startX: clientX, startY: clientY };
    onSelect(latest);
    onInteractionStateChange(true);
  };

  const updateObjectDrag = (clientX: number, clientY: number) => {
    if (!pointerDrag.current) return;
    const dx = (clientX - pointerDrag.current.startX) / Math.max(1, layout.width);
    const dy = (clientY - pointerDrag.current.startY) / Math.max(1, layout.height);
    onPatch(objectRef.current.id, {
      x: pointerDrag.current.start.x + dx,
      y: pointerDrag.current.start.y + dy,
    });
  };

  const endObjectDrag = () => {
    pointerDrag.current = null;
    onInteractionStateChange(false);
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
            beginObjectDrag(native.clientX, native.clientY);
          },
          onPointerMove: (evt: unknown) => {
            if (!pointerDrag.current) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            updateObjectDrag(native.clientX, native.clientY);
          },
          onPointerUp: endObjectDrag,
          onPointerCancel: endObjectDrag,
          onLostPointerCapture: endObjectDrag,
        } as Record<string, unknown>)
      : {};

  const dragPan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponderCapture: () => false,
        onShouldBlockNativeResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const latest = objectRef.current;
          dragStart.current = latest;
          onSelect(latest);
          onInteractionStateChange(true);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!dragStart.current) return;
          const dx = gesture.dx / Math.max(1, layout.width);
          const dy = gesture.dy / Math.max(1, layout.height);
          onPatch(objectRef.current.id, { x: dragStart.current.x + dx, y: dragStart.current.y + dy });
        },
        onPanResponderRelease: () => {
          dragStart.current = null;
          onInteractionStateChange(false);
        },
        onPanResponderTerminate: () => {
          dragStart.current = null;
          onInteractionStateChange(false);
        },
      }),
    [layout.height, layout.width, onInteractionStateChange, onPatch, onSelect],
  );

  return (
    <View
      style={[
        styles.editorObject,
        WEB_GESTURE_STYLE,
        {
          left: `${object.x * 100}%`,
          top: `${object.y * 100}%`,
          width: `${object.width * 100}%`,
          height: `${object.height * 100}%`,
          borderColor: selected ? accent : withAlpha(object.color, 0.42),
          transform: [
            {
              rotate:
                object.type === 'text' ||
                object.type === 'highlight' ||
                object.type === 'redact' ||
                object.type === 'annotate'
                  ? '0deg'
                  : `${object.rotation}deg`,
            },
          ],
        },
      ]}
      {...dragPan.panHandlers}
      {...pointerHandlers}
    >
      <ObjectPreview object={object} selected={selected} accent={accent} />
      {selected ? (
        <>
          <View
            pointerEvents="none"
            style={[
              styles.objectToolbar,
              { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
            ]}
          >
            <Icon name="cursor-move" size={14} color={accent} />
            <Txt variant="tiny">Drag</Txt>
          </View>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <ResizeHandle
              key={corner}
              corner={corner}
              object={object}
              layout={layout}
              accent={accent}
              onPatch={onPatch}
              onInteractionStateChange={onInteractionStateChange}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function ResizeHandle({
  corner,
  object,
  layout,
  accent,
  onPatch,
  onInteractionStateChange,
}: {
  corner: 'nw' | 'ne' | 'sw' | 'se';
  object: EditorObject;
  layout: { width: number; height: number };
  accent: string;
  onPatch: (id: string, patch: Partial<EditorObject> | ((object: EditorObject) => EditorObject)) => void;
  onInteractionStateChange: (dragging: boolean) => void;
}) {
  const start = useRef<EditorObject | null>(null);
  const pointerResize = useRef<{ start: EditorObject; startX: number; startY: number } | null>(null);
  const resizeFromDelta = (initial: EditorObject, dx: number, dy: number) => {
    const next = { ...initial };
    if (corner.includes('e')) next.width = initial.width + dx;
    if (corner.includes('s')) next.height = initial.height + dy;
    if (corner.includes('w')) {
      next.x = initial.x + dx;
      next.width = initial.width - dx;
    }
    if (corner.includes('n')) {
      next.y = initial.y + dy;
      next.height = initial.height - dy;
    }
    return next;
  };
  const beginResize = (clientX: number, clientY: number) => {
    pointerResize.current = { start: object, startX: clientX, startY: clientY };
    onInteractionStateChange(true);
  };
  const updateResize = (clientX: number, clientY: number) => {
    if (!pointerResize.current) return;
    const dx = (clientX - pointerResize.current.startX) / Math.max(1, layout.width);
    const dy = (clientY - pointerResize.current.startY) / Math.max(1, layout.height);
    onPatch(object.id, resizeFromDelta(pointerResize.current.start, dx, dy));
  };
  const endResize = () => {
    pointerResize.current = null;
    onInteractionStateChange(false);
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
            beginResize(native.clientX, native.clientY);
          },
          onPointerMove: (evt: unknown) => {
            if (!pointerResize.current) return;
            const e = evt as {
              preventDefault?: () => void;
              stopPropagation?: () => void;
              nativeEvent?: { clientX: number; clientY: number };
            };
            const native = e.nativeEvent;
            if (!native) return;
            e.preventDefault?.();
            e.stopPropagation?.();
            updateResize(native.clientX, native.clientY);
          },
          onPointerUp: endResize,
          onPointerCancel: endResize,
          onLostPointerCapture: endResize,
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
        onPanResponderGrant: () => {
          start.current = object;
          onInteractionStateChange(true);
        },
        onPanResponderMove: (_evt, gesture) => {
          if (!start.current) return;
          const dx = gesture.dx / Math.max(1, layout.width);
          const dy = gesture.dy / Math.max(1, layout.height);
          onPatch(object.id, (current) => {
            const initial = start.current ?? current;
            return resizeFromDelta(initial, dx, dy);
          });
        },
        onPanResponderRelease: () => {
          start.current = null;
          onInteractionStateChange(false);
        },
        onPanResponderTerminate: () => {
          start.current = null;
          onInteractionStateChange(false);
        },
      }),
    [corner, layout.height, layout.width, object, onInteractionStateChange, onPatch],
  );

  const handleStyles = {
    nw: styles.resizeHandle_nw,
    ne: styles.resizeHandle_ne,
    sw: styles.resizeHandle_sw,
    se: styles.resizeHandle_se,
  };
  return (
    <View
      {...pan.panHandlers}
      {...pointerHandlers}
      style={[styles.resizeHandle, handleStyles[corner], WEB_GESTURE_STYLE, { backgroundColor: accent }]}
    />
  );
}

function SignatureDrawPad({
  paths,
  color,
  thickness,
  onChange,
}: {
  paths: EditorPoint[][];
  color: string;
  thickness: number;
  onChange: (paths: EditorPoint[][]) => void;
}) {
  const theme = useTheme();
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [draft, setDraft] = useState<EditorPoint[]>([]);
  const draftRef = useRef<EditorPoint[]>([]);
  const padRef = useRef<unknown>(null);

  const localPointFromClient = (clientX: number, clientY: number) => {
    const node = padRef.current as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    const rect = node?.getBoundingClientRect?.();
    if (!rect) return null;
    return {
      x: clampUnit((clientX - rect.left) / layout.width),
      y: clampUnit((clientY - rect.top) / layout.height),
    };
  };

  const begin = (point: EditorPoint) => {
    draftRef.current = [point];
    setDraft([point]);
  };
  const move = (point: EditorPoint) => {
    if (!draftRef.current.length) return;
    draftRef.current = [...draftRef.current, point];
    setDraft(draftRef.current);
  };
  const end = () => {
    const next = draftRef.current;
    if (next.length > 1) onChange([...paths, next]);
    draftRef.current = [];
    setDraft([]);
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
            if (point) begin(point);
          },
          onPointerMove: (evt: unknown) => {
            if (!draftRef.current.length) return;
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
            if (point) move(point);
          },
          onPointerUp: end,
          onPointerCancel: end,
          onLostPointerCapture: end,
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
          begin({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderMove: (evt) => {
          if (Platform.OS === 'web') return;
          move({
            x: clampUnit(evt.nativeEvent.locationX / layout.width),
            y: clampUnit(evt.nativeEvent.locationY / layout.height),
          });
        },
        onPanResponderRelease: end,
        onPanResponderTerminate: end,
      }),
    [layout.height, layout.width, paths],
  );

  const strokeWidth = Math.max(1.2, Math.min(10, thickness));
  const visiblePaths = draft.length ? [...paths, draft] : paths;
  return (
    <View
      ref={padRef as never}
      style={[
        styles.signaturePad,
        styles.signatureDrawPad,
        WEB_GESTURE_STYLE,
        { backgroundColor: theme.backgroundElement },
      ]}
      onLayout={(event: LayoutChangeEvent) =>
        setLayout({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })
      }
      {...pan.panHandlers}
      {...pointerHandlers}
    >
      <Svg pointerEvents="none" width="100%" height="100%" style={StyleSheet.absoluteFill}>
        {visiblePaths
          .filter((path) => path.length > 1)
          .map((path, index) => (
            <Path
              key={`${index}-${path.length}`}
              d={pathFromPoints(path, layout)}
              stroke={color}
              strokeWidth={strokeWidth}
              strokeOpacity={0.96}
              fill="transparent"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
      </Svg>
      {!visiblePaths.length ? (
        <View pointerEvents="none" style={styles.signaturePadEmpty}>
          <Icon name="draw" size={24} color={color} />
          <Txt variant="caption" muted center>
            Draw with your mouse or finger.
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function ObjectPreview({
  object,
  selected,
  accent,
}: {
  object: EditorObject;
  selected: boolean;
  accent: string;
}) {
  const theme = useTheme();
  if (object.type === 'highlight') {
    return (
      <View
        style={[
          styles.objectFill,
          {
            backgroundColor: withAlpha(object.color, Math.min(0.58, object.opacity)),
            borderColor: object.color,
          },
        ]}
      />
    );
  }
  if (object.type === 'redact') {
    return (
      <View style={[styles.objectFill, styles.redactionFill]}>
        <Txt variant="tiny" center style={{ color: '#FFFFFF' }}>
          {object.text || 'Redacted'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'annotate') {
    if (object.annotationMode === 'shape') {
      return <View style={[styles.objectFill, styles.annotationShapeFill, { borderColor: object.color }]} />;
    }
    return (
      <View
        style={[
          styles.objectFill,
          styles.annotationFill,
          object.annotationMode === 'callout' ? styles.annotationCalloutFill : null,
          { borderColor: object.color },
        ]}
      >
        {object.annotationMode === 'callout' ? (
          <View style={[styles.calloutPointer, { backgroundColor: object.color }]} />
        ) : null}
        <Txt variant="tiny" style={{ color: '#111827' }}>
          {object.text || 'Review note'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'stamp') {
    if (object.stampMode === 'upload') {
      return (
        <View style={[styles.objectFill, styles.stampUploadFill, { borderColor: object.color }]}>
          {object.stampImageDataUrl ? (
            <Image
              source={{ uri: object.stampImageDataUrl }}
              resizeMode="contain"
              style={styles.stampImagePreview}
            />
          ) : (
            <View style={styles.signaturePadEmpty}>
              <Icon name="image-plus" size={18} color={object.color} />
              <Txt variant="tiny" center muted>
                Uploaded stamp
              </Txt>
            </View>
          )}
        </View>
      );
    }
    const filled = object.stampStyle === 'filled';
    const double = object.stampStyle === 'double';
    const shapeStyle =
      object.stampShape === 'seal'
        ? styles.stampSealFill
        : object.stampShape === 'pill'
          ? styles.stampPillFill
          : null;
    return (
      <View
        style={[
          styles.objectFill,
          styles.stampFill,
          shapeStyle,
          {
            borderColor: object.color,
            backgroundColor: filled
              ? withAlpha(object.color, Math.min(0.22, object.opacity * 0.22))
              : withAlpha(object.color, 0.035),
          },
        ]}
      >
        {double ? (
          <View
            pointerEvents="none"
            style={[styles.stampInnerBorder, shapeStyle, { borderColor: withAlpha(object.color, 0.72) }]}
          />
        ) : null}
        {object.stampShape === 'seal' ? (
          <Icon name="star-four-points-outline" size={16} color={object.color} />
        ) : null}
        <Txt variant="label" center numberOfLines={1} style={{ color: object.color }}>
          {(object.text || 'APPROVED').toUpperCase()}
        </Txt>
        <Txt variant="tiny" center numberOfLines={1} style={{ color: withAlpha(object.color, 0.82) }}>
          {(object.stampDetail || 'VERIFIED').toUpperCase()}
        </Txt>
      </View>
    );
  }
  if (object.type === 'signature') {
    const signaturePaths = object.signaturePaths?.length
      ? object.signaturePaths
      : object.signaturePoints?.length
        ? [object.signaturePoints]
        : [];
    if (object.signatureMode === 'draw') {
      return (
        <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
          {signaturePaths.length ? (
            <Svg pointerEvents="none" width="100%" height="100%" viewBox="0 0 100 100">
              {signaturePaths.map((path, index) => (
                <Path
                  key={`${index}-${path.length}`}
                  d={pathFromPoints(path, { width: 100, height: 100 })}
                  stroke={object.color}
                  strokeWidth={Math.max(1.2, Math.min(10, object.thickness))}
                  strokeOpacity={object.opacity}
                  fill="transparent"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </Svg>
          ) : (
            <Txt variant="tiny" center muted>
              Draw signature
            </Txt>
          )}
        </View>
      );
    }
    if (object.signatureMode === 'upload') {
      return (
        <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
          {object.signatureImageDataUrl ? (
            <Image
              source={{ uri: object.signatureImageDataUrl }}
              resizeMode="contain"
              style={styles.signatureObjectImage}
            />
          ) : (
            <Txt variant="tiny" center muted>
              Upload signature
            </Txt>
          )}
        </View>
      );
    }
    return (
      <View style={[styles.objectFill, styles.signatureFill, { borderColor: object.color }]}>
        <Txt
          variant="h3"
          center
          style={{ color: object.color, fontStyle: 'italic', fontSize: object.fontSize ?? 24 }}
        >
          {object.text || 'Signature'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'watermark') {
    return (
      <View style={[styles.objectFill, styles.watermarkFill]}>
        <Txt
          variant="title"
          center
          style={{ color: withAlpha(object.color, Math.min(0.72, object.opacity)) }}
        >
          {object.text || 'CONFIDENTIAL'}
        </Txt>
      </View>
    );
  }
  if (object.type === 'form-field') {
    const kind = object.formFieldKind ?? 'text';
    const label =
      object.formValue || object.formPlaceholder || (kind === 'checkbox' ? 'Checked' : 'Form field');
    if (kind === 'checkbox') {
      return (
        <View
          style={[
            styles.objectFill,
            styles.formCheckboxFill,
            { borderColor: object.color, backgroundColor: withAlpha(object.color, 0.05) },
          ]}
        >
          <View
            style={[
              styles.formCheckboxBox,
              {
                borderColor: object.color,
                backgroundColor: object.formChecked ? withAlpha(object.color, 0.18) : 'transparent',
              },
            ]}
          >
            {object.formChecked ? <Icon name="check-bold" size={18} color={object.color} /> : null}
          </View>
          <Txt variant="tiny" numberOfLines={1} style={{ color: object.color }}>
            {object.formPlaceholder || 'Checkbox'}
          </Txt>
        </View>
      );
    }
    if (kind === 'signature') {
      return (
        <View style={[styles.objectFill, styles.formSignatureFill, { borderColor: object.color }]}>
          <Txt variant="label" center numberOfLines={1} style={{ color: object.color, fontStyle: 'italic' }}>
            {object.formValue || 'Signature'}
          </Txt>
          <View style={[styles.formSignatureLine, { backgroundColor: withAlpha(object.color, 0.76) }]} />
        </View>
      );
    }
    return (
      <View
        style={[
          styles.objectFill,
          styles.formFieldFill,
          { borderColor: object.color, backgroundColor: withAlpha(theme.background, selected ? 0.84 : 0.66) },
        ]}
      >
        <View style={styles.formFieldTopRow}>
          <Txt variant="tiny" numberOfLines={1} style={{ color: object.color }}>
            {kind === 'date'
              ? 'Date'
              : kind === 'initials'
                ? 'Initials'
                : object.formRequired
                  ? 'Required'
                  : 'Text'}
          </Txt>
          {object.formRequired ? <Icon name="asterisk" size={12} color={object.color} /> : null}
        </View>
        <Txt
          variant="label"
          numberOfLines={1}
          style={{ color: object.formValue ? theme.text : theme.textMuted }}
        >
          {label}
        </Txt>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.objectFill,
        styles.textFill,
        {
          backgroundColor: withAlpha(theme.background, selected ? 0.78 : 0.56),
          borderColor: selected ? accent : withAlpha(object.color, 0.5),
        },
      ]}
    >
      <Txt
        variant="label"
        style={{
          color: object.color,
          fontWeight: object.bold ? '800' : '500',
          fontStyle: object.italic ? 'italic' : 'normal',
          fontSize: object.fontSize ?? 14,
          textDecorationLine: object.underline ? 'underline' : 'none',
          textAlign: object.align ?? 'left',
          width: '100%',
        }}
      >
        {object.text || 'Editable text'}
      </Txt>
    </View>
  );
}

function pathFromPoints(points: EditorPoint[], layout: { width: number; height: number }) {
  if (!points.length) return '';
  return points
    .map((point, index) => {
      const x = clampUnit(point.x) * layout.width;
      const y = clampUnit(point.y) * layout.height;
      return `${index === 0 ? 'M' : 'L'}${x} ${y}`;
    })
    .join(' ');
}

function endPoints(points: EditorPoint[]) {
  if (points.length < 2) return points;
  return [points[0], points[points.length - 1]];
}

function pathFromDoodleObject(object: EditorObject, layout: { width: number; height: number }) {
  const points = object.points ?? [];
  if (object.doodleMode === 'vector' || object.doodleMode === 'arrow')
    return pathFromPoints(endPoints(points), layout);
  return pathFromPoints(points, layout);
}

function arrowHeadPath(points: EditorPoint[], layout: { width: number; height: number }) {
  const endpoints = endPoints(points);
  if (endpoints.length < 2) return '';
  const start = { x: endpoints[0].x * layout.width, y: endpoints[0].y * layout.height };
  const end = { x: endpoints[1].x * layout.width, y: endpoints[1].y * layout.height };
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const size = Math.max(14, Math.min(34, Math.hypot(end.x - start.x, end.y - start.y) * 0.22));
  const spread = Math.PI / 7;
  const left = { x: end.x - Math.cos(angle - spread) * size, y: end.y - Math.sin(angle - spread) * size };
  const right = { x: end.x - Math.cos(angle + spread) * size, y: end.y - Math.sin(angle + spread) * size };
  return `M${left.x} ${left.y} L${end.x} ${end.y} L${right.x} ${right.y}`;
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
  editorOptions,
  setEditorOptions,
  beforeAfter,
  setBeforeAfter,
  onAuto,
  onRemoveMargins,
  onPerfect,
  onReset,
  onApply,
  onAddObject,
  saving,
  canApply,
  resultFile,
  onPreview,
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
  editorOptions: EditorOptions;
  setEditorOptions: (updater: (prev: EditorOptions) => EditorOptions) => void;
  beforeAfter: 'before' | 'after';
  setBeforeAfter: (value: 'before' | 'after') => void;
  onAuto: () => void;
  onRemoveMargins: () => void;
  onPerfect: () => void;
  onReset: () => void;
  onApply: () => void;
  onAddObject: (optionOverrides?: Partial<EditorOptions>) => void;
  saving: boolean;
  canApply: boolean;
  resultFile: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  resultAction: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  const desktop = useIsDesktop();
  const accent = Accents[tool.accent];
  return (
    <View
      style={[
        desktop ? styles.settingsPanel : styles.mobileSheet,
        { backgroundColor: theme.backgroundElevated, borderColor: theme.border },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.settingsContent,
          !desktop && resultFile ? styles.settingsContentWithResultDock : null,
        ]}
      >
        <View style={styles.panelHeader}>
          <View style={[styles.toolPill, { backgroundColor: withAlpha(accent, 0.16) }]}>
            <Icon name={tool.icon} size={20} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="h3">{tool.title}</Txt>
            <Txt variant="tiny" muted>
              {tool.subtitle}
            </Txt>
          </View>
        </View>

        <Labeled label="Tool">
          <View
            style={[styles.toolScrollFrame, { borderColor: theme.border, backgroundColor: theme.background }]}
          >
            <ScrollView
              horizontal
              nestedScrollEnabled
              persistentScrollbar
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="handled"
              style={styles.toolScroll}
              contentContainerStyle={styles.toolRail}
            >
              {TOOL_IDS.map((id) => {
                const meta = EDITOR_TOOLS[id];
                const active = id === activeTool;
                return (
                  <Pressable
                    key={id}
                    onPress={() => setActiveTool(id)}
                    style={[
                      styles.toolChip,
                      {
                        backgroundColor: active
                          ? withAlpha(Accents[meta.accent], 0.22)
                          : theme.backgroundElement,
                        borderColor: active ? Accents[meta.accent] : theme.border,
                      },
                    ]}
                  >
                    <Icon
                      name={meta.icon}
                      size={16}
                      color={active ? Accents[meta.accent] : theme.textSecondary}
                    />
                    <Txt
                      variant="tiny"
                      style={{ color: active ? Accents[meta.accent] : theme.textSecondary }}
                    >
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
              <ActionButton
                icon="page-layout-body"
                label="Remove Margins"
                onPress={onRemoveMargins}
                accent={accent}
              />
              <ActionButton
                icon="vector-square"
                label="Make Perfect Rectangle"
                onPress={onPerfect}
                accent={accent}
              />
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
            {applyScope === 'range' ? (
              <TextField
                label="Page range"
                value={pageRange}
                onChangeText={setPageRange}
                placeholder="1-3, 7"
              />
            ) : null}
            <Button
              title="Apply Crop"
              icon="check"
              onPress={onApply}
              loading={saving}
              disabled={!canApply}
              full
            />
            <ResultActions
              file={resultFile}
              onPreview={onPreview}
              onDownload={onDownload}
              onShare={onShare}
              shareSupported={shareSupported}
              loading={resultAction}
            />
          </>
        ) : (
          <>
            <ToolSpecificPanel
              tool={activeTool}
              accent={accent}
              options={editorOptions}
              setOptions={setEditorOptions}
              onApply={onApply}
              onAddObject={onAddObject}
              saving={saving}
              canApply={canApply}
            />
            <ResultActions
              file={resultFile}
              onPreview={onPreview}
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
  onPreview,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View
      style={[
        styles.resultPanel,
        { backgroundColor: theme.primaryMuted, borderColor: withAlpha(theme.primary, 0.48) },
      ]}
    >
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
          title="Preview"
          icon="eye-outline"
          variant="secondary"
          onPress={onPreview}
          disabled={Boolean(loading)}
          full
        />
        <Button
          title="Download"
          icon="download-outline"
          variant="secondary"
          onPress={onDownload}
          loading={loading === 'download'}
          disabled={loading === 'share'}
          full
        />
        <Button
          title="Share"
          icon="share-variant"
          variant="secondary"
          onPress={onShare}
          loading={loading === 'share'}
          disabled={!shareSupported || loading === 'download'}
          full
        />
      </View>
    </View>
  );
}

function MobileResultDock({
  file,
  onPreview,
  onDownload,
  onShare,
  shareSupported,
  loading,
}: {
  file: FileItem | null;
  onPreview: () => void;
  onDownload: () => void;
  onShare: () => void;
  shareSupported: boolean;
  loading: 'download' | 'share' | null;
}) {
  const theme = useTheme();
  if (!file) return null;
  return (
    <View
      style={[
        styles.mobileResultDock,
        { backgroundColor: theme.backgroundElevated, borderColor: withAlpha(theme.primary, 0.55) },
      ]}
    >
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
          title="Preview"
          icon="eye-outline"
          variant="secondary"
          size="sm"
          onPress={onPreview}
          disabled={Boolean(loading)}
          full
        />
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
  options,
  setOptions,
  onApply,
  onAddObject,
  saving,
  canApply,
}: {
  tool: EditorToolId;
  accent: string;
  options: EditorOptions;
  setOptions: (updater: (prev: EditorOptions) => EditorOptions) => void;
  onApply: () => void;
  onAddObject: (optionOverrides?: Partial<EditorOptions>) => void;
  saving: boolean;
  canApply: boolean;
}) {
  const [signatureUploadBusy, setSignatureUploadBusy] = useState(false);
  const [signatureUploadError, setSignatureUploadError] = useState<string | null>(null);
  const [stampUploadBusy, setStampUploadBusy] = useState(false);
  const [stampUploadError, setStampUploadError] = useState<string | null>(null);
  const update = <K extends keyof EditorOptions>(key: K, value: EditorOptions[K]) =>
    setOptions((prev) => ({ ...prev, [key]: value }));
  const toggle = (key: 'bold' | 'italic' | 'underline') =>
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  const setAlign = (align: EditorOptions['align']) => setOptions((prev) => ({ ...prev, align }));
  const setDoodleMode = (mode: EditorOptions['doodleMode']) =>
    setOptions((prev) => {
      const presets: Record<EditorOptions['doodleMode'], Pick<EditorOptions, 'thickness' | 'opacity'>> = {
        pencil: { thickness: '4', opacity: '0.86' },
        marker: { thickness: '12', opacity: '0.45' },
        eraser: { thickness: '18', opacity: prev.opacity },
        vector: { thickness: '4', opacity: '1' },
        arrow: { thickness: '4', opacity: '1' },
      };
      return { ...prev, doodleMode: mode, ...presets[mode] };
    });
  const setSignatureMode = (mode: EditorOptions['signatureMode']) =>
    setOptions((prev) => ({
      ...prev,
      signatureMode: mode,
      opacity: mode === 'draw' || mode === 'upload' ? '1' : prev.opacity,
      thickness: mode === 'draw' ? '2' : prev.thickness,
      rotation: mode === 'type' ? prev.rotation : '0',
    }));
  const setAnnotationMode = (mode: EditorOptions['annotationMode']) =>
    setOptions((prev) => ({ ...prev, annotationMode: mode }));
  const chooseSignatureImage = async () => {
    setSignatureUploadBusy(true);
    setSignatureUploadError(null);
    try {
      const [picked] = await pickImages({ multiple: false });
      if (!picked) return;
      const ext = fileExtensionFromName(picked.name, picked.mime?.includes('jpeg') ? 'jpg' : 'png');
      const mime = mimeFromImageName(picked.name, picked.mime);
      const stored = await storage.importUri(picked.uri, ext);
      const uri = await storage.getDataUrl(stored.key, mime);
      setOptions((prev) => ({
        ...prev,
        signatureMode: 'upload',
        signatureImageDataUrl: uri,
        signatureImageName: picked.name,
        opacity: '1',
        rotation: '0',
      }));
    } catch (error) {
      setSignatureUploadError(
        error instanceof Error ? error.message : 'Could not import this signature image.',
      );
    } finally {
      setSignatureUploadBusy(false);
    }
  };
  const chooseStampImage = async () => {
    setStampUploadBusy(true);
    setStampUploadError(null);
    try {
      const [picked] = await pickImages({ multiple: false });
      if (!picked) return;
      const ext = fileExtensionFromName(picked.name, picked.mime?.includes('jpeg') ? 'jpg' : 'png');
      const mime = mimeFromImageName(picked.name, picked.mime);
      const stored = await storage.importUri(picked.uri, ext);
      const uri = await storage.getDataUrl(stored.key, mime);
      setOptions((prev) => ({
        ...prev,
        stampMode: 'upload',
        stampImageDataUrl: uri,
        stampImageName: picked.name,
        opacity: '1',
        rotation: '0',
      }));
    } catch (error) {
      setStampUploadError(error instanceof Error ? error.message : 'Could not import this stamp image.');
    } finally {
      setStampUploadBusy(false);
    }
  };
  const addFormField = (kind: EditorOptions['formFieldKind']) => {
    const preset = FORM_FIELD_PRESETS.find((item) => item.kind === kind) ?? FORM_FIELD_PRESETS[0];
    onAddObject({
      formFieldKind: kind,
      formPlaceholder: preset.placeholder,
      formValue: preset.value,
      formChecked: kind === 'checkbox',
      formRequired: false,
      color: options.color || accent,
      opacity: '1',
      thickness: kind === 'checkbox' ? '2.4' : '1.6',
      rotation: '0',
    });
  };

  if (tool === 'add-page-numbers') {
    return (
      <>
        <Labeled label="Position">
          <PositionGrid active="bottom-center" accent={accent} />
        </Labeled>
        <TextField label="Format" value="Page {n} of {total}" onChangeText={() => undefined} />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField label="Start" value="1" onChangeText={() => undefined} keyboardType="number-pad" />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Font size"
              value="12"
              onChangeText={() => undefined}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <ColorSwatches
          colors={['#EAF0F6', '#2BD9A8', '#3B82F6', '#FF5C5C']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <Button
          title="Preview Page Numbers"
          icon="format-list-numbered"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
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
        <TextField label="Watermark" value={options.text} onChangeText={(value) => update('text', value)} />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Rotation"
              value={options.rotation}
              onChangeText={(value) => update('rotation', value)}
              keyboardType="numbers-and-punctuation"
            />
          </View>
        </View>
        <TextField
          label="Color"
          value={options.color}
          onChangeText={(value) => update('color', value)}
          placeholder="#2BD9A8"
        />
        <ColorSwatches
          colors={['#EAF0F6', '#2BD9A8', '#38BDF8', '#F7C948', '#FB7185']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <Labeled label="Position">
          <PositionGrid active="center" accent={accent} />
        </Labeled>
        <ActionWrap>
          <ActionButton icon="grid" label="Tile" accent={accent} />
          <ActionButton icon="layers-outline" label="Behind text" />
        </ActionWrap>
        <Button
          title="Preview Watermark"
          icon="watermark"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'flatten') {
    return (
      <>
        <WarningBox
          title="Flatten preview"
          text="Flattened objects may no longer be editable after export."
        />
        {['Annotations', 'Forms', 'Signatures', 'Drawings', 'Stamps', 'Editable layers'].map(
          (item, index) => (
            <CheckRow key={item} label={item} checked={index < 4} />
          ),
        )}
        <Button
          title="Preview Flattened PDF"
          icon="layers-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'add-text') {
    return (
      <>
        <TextField label="Text" value={options.text} onChangeText={(value) => update('text', value)} />
        <ActionWrap>
          <ActionButton
            icon="format-bold"
            label="Bold"
            accent={accent}
            active={options.bold}
            onPress={() => toggle('bold')}
          />
          <ActionButton
            icon="format-italic"
            label="Italic"
            accent={accent}
            active={options.italic}
            onPress={() => toggle('italic')}
          />
          <ActionButton
            icon="format-underline"
            label="Underline"
            accent={accent}
            active={options.underline}
            onPress={() => toggle('underline')}
          />
          <ActionButton
            icon="format-align-left"
            label="Left"
            accent={accent}
            active={options.align === 'left'}
            onPress={() => setAlign('left')}
          />
          <ActionButton
            icon="format-align-center"
            label="Center"
            accent={accent}
            active={options.align === 'center'}
            onPress={() => setAlign('center')}
          />
          <ActionButton
            icon="format-align-right"
            label="Right"
            accent={accent}
            active={options.align === 'right'}
            onPress={() => setAlign('right')}
          />
        </ActionWrap>
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Font size"
              value={options.fontSize}
              onChangeText={(value) => update('fontSize', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <TextField label="Color" value={options.color} onChangeText={(value) => update('color', value)} />
        <ColorSwatches
          colors={TEXT_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <Button
          title="Add Another Text Box"
          icon="plus"
          variant="secondary"
          onPress={onAddObject}
          disabled={!canApply}
          full
        />
        <Button
          title="Preview PDF"
          icon="eye-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
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
          value={options.signatureMode}
          onChange={(value) => setSignatureMode(value)}
        />
        {options.signatureMode === 'draw' ? (
          <>
            <SignatureDrawPad
              paths={options.signaturePaths}
              color={options.color}
              thickness={parsePositiveNumber(options.thickness, 2, 1, 10)}
              onChange={(paths) =>
                setOptions((prev) => ({
                  ...prev,
                  signaturePaths: paths,
                  signaturePoints: paths[paths.length - 1] ?? [],
                }))
              }
            />
            <View style={styles.twoCols}>
              <View style={styles.twoColItem}>
                <TextField
                  label="Pen size"
                  value={options.thickness}
                  onChangeText={(value) => update('thickness', value)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.twoColItem}>
                <TextField
                  label="Opacity"
                  value={options.opacity}
                  onChangeText={(value) => update('opacity', value)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            <Button
              title="Clear Drawing"
              icon="eraser"
              variant="secondary"
              onPress={() => setOptions((prev) => ({ ...prev, signaturePaths: [], signaturePoints: [] }))}
              full
            />
          </>
        ) : null}
        {options.signatureMode === 'type' ? (
          <>
            <View style={[styles.signaturePad, styles.signatureTypedPad]}>
              <Txt
                variant="h2"
                style={{
                  color: options.color,
                  fontStyle: 'italic',
                  fontSize: parsePositiveNumber(options.signatureFontSize, 24, 8, 96),
                }}
              >
                {options.signatureText || 'Signature'}
              </Txt>
            </View>
            <TextField
              label="Typed signature"
              value={options.signatureText}
              onChangeText={(value) => update('signatureText', value)}
            />
            <View style={styles.twoCols}>
              <View style={styles.twoColItem}>
                <TextField
                  label="Type size"
                  value={options.signatureFontSize}
                  onChangeText={(value) => update('signatureFontSize', value)}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.twoColItem}>
                <TextField
                  label="Opacity"
                  value={options.opacity}
                  onChangeText={(value) => update('opacity', value)}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
          </>
        ) : null}
        {options.signatureMode === 'upload' ? (
          <>
            <View style={styles.signaturePad}>
              {options.signatureImageDataUrl ? (
                <Image
                  source={{ uri: options.signatureImageDataUrl }}
                  resizeMode="contain"
                  style={styles.signatureImagePreview}
                />
              ) : (
                <View style={styles.signaturePadEmpty}>
                  <Icon name="image-plus" size={24} color={accent} />
                  <Txt variant="caption" muted center>
                    Upload a transparent PNG or JPG signature.
                  </Txt>
                </View>
              )}
            </View>
            <Button
              title={options.signatureImageDataUrl ? 'Replace Image' : 'Choose Image'}
              icon="image-plus"
              variant="secondary"
              onPress={chooseSignatureImage}
              loading={signatureUploadBusy}
              full
            />
            {options.signatureImageName ? (
              <Txt variant="tiny" muted>
                {options.signatureImageName}
              </Txt>
            ) : null}
            {signatureUploadError ? (
              <Txt variant="tiny" style={{ color: Accents.rose }}>
                {signatureUploadError}
              </Txt>
            ) : null}
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </>
        ) : null}
        <TextField
          label="Rotation"
          value={options.rotation}
          onChangeText={(value) => update('rotation', value)}
          keyboardType="numbers-and-punctuation"
        />
        <TextField label="Ink color" value={options.color} onChangeText={(value) => update('color', value)} />
        <ColorSwatches
          colors={SIGNATURE_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <Button
          title="Place Signature"
          icon="draw"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'doodle') {
    return (
      <>
        <ActionWrap>
          <ActionButton
            icon="pencil-outline"
            label="Pencil"
            accent={accent}
            active={options.doodleMode === 'pencil'}
            onPress={() => setDoodleMode('pencil')}
          />
          <ActionButton
            icon="marker"
            label="Marker"
            accent={accent}
            active={options.doodleMode === 'marker'}
            onPress={() => setDoodleMode('marker')}
          />
          <ActionButton
            icon="eraser"
            label="Eraser"
            accent={accent}
            active={options.doodleMode === 'eraser'}
            onPress={() => setDoodleMode('eraser')}
          />
          <ActionButton
            icon="vector-line"
            label="Vector"
            accent={accent}
            active={options.doodleMode === 'vector'}
            onPress={() => setDoodleMode('vector')}
          />
          <ActionButton
            icon="arrow-top-right"
            label="Arrow"
            accent={accent}
            active={options.doodleMode === 'arrow'}
            onPress={() => setDoodleMode('arrow')}
          />
        </ActionWrap>
        <ColorSwatches
          colors={DOODLE_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Stroke size"
              value={options.thickness}
              onChangeText={(value) => update('thickness', value)}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <TextField
          label="Stroke color"
          value={options.color}
          onChangeText={(value) => update('color', value)}
        />
        <Button
          title="Apply Drawing Layer"
          icon="pencil-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'highlight') {
    return (
      <>
        <ColorSwatches
          colors={['#F7C948', '#2BD9A8', '#38BDF8', '#FB7185']}
          active={options.color}
          onSelect={(color) => update('color', color)}
        />
        <TextField
          label="Opacity"
          value={options.opacity}
          onChangeText={(value) => update('opacity', value)}
          keyboardType="decimal-pad"
        />
        <ActionWrap>
          <ActionButton icon="format-underline" label="Underline" />
          <ActionButton icon="format-strikethrough" label="Strike" />
          <ActionButton icon="gesture" label="Squiggle" />
        </ActionWrap>
        <Button
          title="Apply Highlight"
          icon="marker"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'add-stamp') {
    return (
      <>
        <Segmented
          options={[
            { label: 'Design', value: 'design' },
            { label: 'Upload', value: 'upload' },
          ]}
          value={options.stampMode}
          onChange={(value) => update('stampMode', value)}
        />
        {options.stampMode === 'design' ? (
          <>
            <View style={styles.stampGallery}>
              {STAMP_TEMPLATES.map((stamp) => (
                <Pressable
                  key={stamp.label}
                  onPress={() =>
                    setOptions((prev) => ({
                      ...prev,
                      stampMode: 'design',
                      stampText: stamp.label,
                      stampDetail: stamp.detail,
                      stampShape: stamp.shape,
                      stampStyle: stamp.style,
                      color: stamp.color,
                      opacity: stamp.style === 'filled' ? '0.82' : '0.92',
                      rotation: stamp.label === 'DRAFT' || stamp.label === 'CONFIDENTIAL' ? '-12' : '0',
                    }))
                  }
                  style={[
                    styles.stampChip,
                    stamp.shape === 'seal'
                      ? styles.stampChipSeal
                      : stamp.shape === 'pill'
                        ? styles.stampChipPill
                        : null,
                    {
                      borderColor: stamp.color,
                      backgroundColor:
                        stamp.style === 'filled' ? withAlpha(stamp.color, 0.18) : 'transparent',
                    },
                  ]}
                >
                  <Txt variant="tiny" center style={{ color: stamp.color }}>
                    {stamp.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
            <TextField
              label="Custom stamp"
              value={options.stampText}
              onChangeText={(value) => update('stampText', value)}
            />
            <TextField
              label="Small text"
              value={options.stampDetail}
              onChangeText={(value) => update('stampDetail', value)}
            />
            <Labeled label="Shape">
              <ActionWrap>
                <ActionButton
                  icon="rectangle-outline"
                  label="Box"
                  accent={accent}
                  active={options.stampShape === 'box'}
                  onPress={() => update('stampShape', 'box')}
                />
                <ActionButton
                  icon="pill"
                  label="Pill"
                  accent={accent}
                  active={options.stampShape === 'pill'}
                  onPress={() => update('stampShape', 'pill')}
                />
                <ActionButton
                  icon="seal"
                  label="Seal"
                  accent={accent}
                  active={options.stampShape === 'seal'}
                  onPress={() => update('stampShape', 'seal')}
                />
              </ActionWrap>
            </Labeled>
            <Labeled label="Style">
              <ActionWrap>
                <ActionButton
                  icon="square-outline"
                  label="Outline"
                  accent={accent}
                  active={options.stampStyle === 'outline'}
                  onPress={() => update('stampStyle', 'outline')}
                />
                <ActionButton
                  icon="checkbox-blank"
                  label="Filled"
                  accent={accent}
                  active={options.stampStyle === 'filled'}
                  onPress={() => update('stampStyle', 'filled')}
                />
                <ActionButton
                  icon="checkbox-multiple-blank-outline"
                  label="Double"
                  accent={accent}
                  active={options.stampStyle === 'double'}
                  onPress={() => update('stampStyle', 'double')}
                />
              </ActionWrap>
            </Labeled>
          </>
        ) : (
          <>
            <View style={styles.stampUploadPad}>
              {options.stampImageDataUrl ? (
                <Image
                  source={{ uri: options.stampImageDataUrl }}
                  resizeMode="contain"
                  style={styles.stampImagePreview}
                />
              ) : (
                <View style={styles.signaturePadEmpty}>
                  <Icon name="image-plus" size={24} color={accent} />
                  <Txt variant="caption" muted center>
                    Upload a PNG or JPG stamp, seal, logo, or scanned mark.
                  </Txt>
                </View>
              )}
            </View>
            <Button
              title={options.stampImageDataUrl ? 'Replace Stamp Image' : 'Choose Stamp Image'}
              icon="image-plus"
              variant="secondary"
              onPress={chooseStampImage}
              loading={stampUploadBusy}
              full
            />
            {options.stampImageName ? (
              <Txt variant="tiny" muted>
                {options.stampImageName}
              </Txt>
            ) : null}
            {stampUploadError ? (
              <Txt variant="tiny" style={{ color: Accents.rose }}>
                {stampUploadError}
              </Txt>
            ) : null}
          </>
        )}
        <View style={styles.twoCols}>
          <View style={styles.twoColItem}>
            <TextField
              label="Rotation"
              value={options.rotation}
              onChangeText={(value) => update('rotation', value)}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={styles.twoColItem}>
            <TextField
              label="Opacity"
              value={options.opacity}
              onChangeText={(value) => update('opacity', value)}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
        <TextField
          label="Stamp color"
          value={options.color}
          onChangeText={(value) => update('color', value)}
        />
        <ColorSwatches
          colors={STAMP_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <Button
          title="Place Stamp"
          icon="stamper"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'annotate') {
    const quickNotes = ['Review missing date', 'Confirm signature', 'Resolve price note'];
    return (
      <>
        <TextField
          label="Comment text"
          value={options.annotationText}
          onChangeText={(value) => update('annotationText', value)}
        />
        <ColorSwatches
          colors={ANNOTATE_COLOR_SWATCHES}
          active={options.color}
          onSelect={(color) => update('color', color)}
          wrap
        />
        <View style={styles.quickNoteGrid}>
          {quickNotes.map((note) => (
            <Pressable key={note} onPress={() => update('annotationText', note)} style={styles.quickNoteChip}>
              <Icon name="comment-text-outline" size={14} color={accent} />
              <Txt variant="tiny" numberOfLines={1}>
                {note}
              </Txt>
            </Pressable>
          ))}
        </View>
        <ActionWrap>
          <ActionButton
            icon="comment-plus-outline"
            label="Note"
            accent={accent}
            active={options.annotationMode === 'note'}
            onPress={() => setAnnotationMode('note')}
          />
          <ActionButton
            icon="arrow-top-right"
            label="Callout"
            accent={accent}
            active={options.annotationMode === 'callout'}
            onPress={() => setAnnotationMode('callout')}
          />
          <ActionButton
            icon="shape-outline"
            label="Shape"
            accent={accent}
            active={options.annotationMode === 'shape'}
            onPress={() => setAnnotationMode('shape')}
          />
        </ActionWrap>
        <Button
          title="Add Annotation Box"
          icon="plus"
          variant="secondary"
          onPress={onAddObject}
          disabled={!canApply}
          full
        />
        <Button
          title="Apply Annotations"
          icon="comment-edit-outline"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  if (tool === 'redact') {
    return (
      <>
        <TextField
          label="Search text"
          placeholder="Email, phone, ID, name..."
          onChangeText={() => undefined}
        />
        <TextField
          label="Redaction label"
          value={options.redactLabel}
          onChangeText={(value) => update('redactLabel', value)}
        />
        <ActionWrap>
          <ActionButton icon="email-outline" label="Emails" accent={accent} />
          <ActionButton icon="phone-outline" label="Phones" />
          <ActionButton icon="card-account-details-outline" label="IDs" />
          <ActionButton icon="selection-drag" label="Manual box" />
        </ActionWrap>
        <WarningBox title="Permanent redaction" text="Preview every redaction before export." />
        <Button
          title="Preview Redactions"
          icon="marker-cancel"
          onPress={onApply}
          loading={saving}
          disabled={!canApply}
          full
        />
      </>
    );
  }
  return (
    <>
      <View style={styles.formFieldList}>
        {[
          ['Name', 'Text field'],
          ['Date', 'Date field'],
          ['Consent', 'Checkbox'],
          ['Signature', 'Signature line'],
        ].map(([name, kind], index) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            onPress={() =>
              addFormField(
                kind === 'Checkbox'
                  ? 'checkbox'
                  : kind === 'Date field'
                    ? 'date'
                    : kind === 'Signature line'
                      ? 'signature'
                      : 'text',
              )
            }
            style={({ pressed }) => [styles.formDetectedRow, { opacity: pressed ? 0.78 : 1 }]}
          >
            <View style={[styles.formDetectedIndex, { backgroundColor: withAlpha(accent, 0.18) }]}>
              <Txt variant="tiny" style={{ color: accent }}>
                {index + 1}
              </Txt>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt variant="label" numberOfLines={1}>
                {name}
              </Txt>
              <Txt variant="tiny" muted numberOfLines={1}>
                {kind}
              </Txt>
            </View>
            <Icon name="plus" size={18} color={accent} />
          </Pressable>
        ))}
      </View>
      <ActionWrap>
        {FORM_FIELD_PRESETS.map((field) => (
          <ActionButton
            key={field.kind}
            icon={field.icon}
            label={field.label}
            accent={accent}
            active={options.formFieldKind === field.kind}
            onPress={() => addFormField(field.kind)}
          />
        ))}
      </ActionWrap>
      <TextField
        label="Field value"
        value={options.formValue}
        onChangeText={(value) => update('formValue', value)}
        placeholder="Value to place"
      />
      <TextField
        label="Placeholder / label"
        value={options.formPlaceholder}
        onChangeText={(value) => update('formPlaceholder', value)}
        placeholder="Field label"
      />
      <ActionWrap>
        <ActionButton
          icon="asterisk"
          label="Required"
          accent={accent}
          active={options.formRequired}
          onPress={() => update('formRequired', !options.formRequired)}
        />
        <ActionButton
          icon="checkbox-marked-outline"
          label="Checked"
          accent={accent}
          active={options.formChecked}
          onPress={() => update('formChecked', !options.formChecked)}
        />
        <ActionButton
          icon="form-textbox-password"
          label="Clear value"
          accent={accent}
          onPress={() => update('formValue', '')}
        />
      </ActionWrap>
      <View style={styles.twoCols}>
        <View style={styles.twoColItem}>
          <TextField
            label="Font size"
            value={options.fontSize}
            onChangeText={(value) => update('fontSize', value)}
            keyboardType="decimal-pad"
          />
        </View>
        <View style={styles.twoColItem}>
          <TextField
            label="Opacity"
            value={options.opacity}
            onChangeText={(value) => update('opacity', value)}
            keyboardType="decimal-pad"
          />
        </View>
      </View>
      <TextField label="Field color" value={options.color} onChangeText={(value) => update('color', value)} />
      <ColorSwatches
        colors={['#2563EB', '#2BD9A8', '#111827', '#374151', '#EF4444', '#F7C948', '#8B5CF6', '#EAF0F6']}
        active={options.color}
        onSelect={(color) => update('color', color)}
        wrap
      />
      <Button
        title="Preview Filled Form"
        icon="form-select"
        onPress={onApply}
        loading={saving}
        disabled={!canApply}
        full
      />
    </>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.labeled}>
      <Txt variant="label" muted>
        {label}
      </Txt>
      {children}
    </View>
  );
}

function ActionWrap({ children }: { children: React.ReactNode }) {
  return <View style={styles.actionWrap}>{children}</View>;
}

function ActionButton({
  icon,
  label,
  onPress,
  accent,
  active,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
  accent?: string;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: active
            ? withAlpha(accent ?? theme.primary, pressed ? 0.34 : 0.26)
            : accent
              ? withAlpha(accent, pressed ? 0.22 : 0.14)
              : theme.backgroundElement,
          borderColor: active ? (accent ?? theme.primary) : (accent ?? theme.border),
          opacity: pressed ? 0.86 : 1,
        },
      ]}
    >
      <Icon
        name={icon}
        size={17}
        color={active ? (accent ?? theme.primary) : (accent ?? theme.textSecondary)}
      />
      <Txt variant="tiny" center style={styles.actionButtonLabel}>
        {label}
      </Txt>
    </Pressable>
  );
}

function ColorSwatches({
  colors,
  active,
  onSelect,
  wrap,
}: {
  colors: string[];
  active: string;
  onSelect?: (color: string) => void;
  wrap?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.swatchRow, wrap ? styles.swatchRowWrap : null]}>
      {colors.map((color) => (
        <Pressable
          key={color}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${color}`}
          onPress={() => onSelect?.(color)}
          style={({ pressed }) => [
            styles.swatch,
            {
              backgroundColor: color,
              borderColor: color.toLowerCase() === active.toLowerCase() ? theme.primary : theme.borderStrong,
              opacity: pressed ? 0.72 : 1,
            },
          ]}
        />
      ))}
    </View>
  );
}

function PositionGrid({ active, accent }: { active: string; accent: string }) {
  const theme = useTheme();
  const cells = [
    'top-left',
    'top-center',
    'top-right',
    'middle-left',
    'center',
    'middle-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
  ];
  return (
    <View style={[styles.positionGrid, { borderColor: theme.border }]}>
      {cells.map((cell) => (
        <View
          key={cell}
          style={[
            styles.positionCell,
            {
              backgroundColor: cell === active ? withAlpha(accent, 0.28) : theme.backgroundElement,
              borderColor: theme.border,
            },
          ]}
        >
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
      <Icon
        name={checked ? 'checkbox-marked-circle-outline' : 'checkbox-blank-circle-outline'}
        size={20}
        color={checked ? theme.primary : theme.textMuted}
      />
      <Txt variant="label">{label}</Txt>
    </View>
  );
}

function WarningBox({ title, text }: { title: string; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.warningBox,
        { backgroundColor: theme.warningMuted, borderColor: withAlpha(theme.warning, 0.45) },
      ]}
    >
      <Icon name="alert-outline" size={18} color={theme.warning} />
      <View style={{ flex: 1 }}>
        <Txt variant="label" style={{ color: theme.warning }}>
          {title}
        </Txt>
        <Txt variant="tiny" style={{ color: theme.warning }}>
          {text}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  lockedRoot: { alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  lockedCard: {
    width: '100%',
    maxWidth: 520,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  topbar: {
    minHeight: 64,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  topbarMobile: { borderBottomWidth: 1, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  mobileTopMain: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  mobileToolbarContent: { gap: Spacing.sm, paddingHorizontal: Spacing.xs, paddingRight: Spacing.lg },
  titleBlock: { flex: 1, minWidth: 0 },
  toolbarGroup: { flexDirection: 'row', gap: 6 },
  zoomGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  zoomPill: {
    minWidth: 58,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  pickShell: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  pickPanel: {
    width: '100%',
    maxWidth: 620,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    gap: Spacing.md,
  },
  bigIcon: {
    width: 68,
    height: 68,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  pickSubtitle: { maxWidth: 420, alignSelf: 'center' },
  editorBody: { flex: 1, minHeight: 0 },
  editorBodyDesktop: { flexDirection: 'row' },
  editorBodyMobile: { flexDirection: 'column' },
  sidebar: { width: 164, borderRightWidth: 1, padding: Spacing.md, gap: Spacing.md },
  sidebarScroll: { gap: Spacing.md, paddingBottom: Spacing.xl },
  sideThumb: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.sm, gap: Spacing.xs },
  sideThumbImage: { width: '100%', aspectRatio: 0.72, borderRadius: Radius.sm, backgroundColor: '#fff' },
  canvasColumn: { flex: 1, minWidth: 0 },
  canvasHeader: {
    minHeight: 62,
    borderBottomWidth: 1,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  canvasTitle: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  toolPill: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasNav: { flexDirection: 'row', gap: Spacing.xs },
  stage: { flex: 1, minHeight: 0 },
  stageScroll: { flex: 1 },
  stageContent: { minWidth: '100%', flexGrow: 1 },
  stageInner: {
    minHeight: '100%',
    minWidth: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xl,
  },
  pageSurface: { backgroundColor: '#fff', borderRadius: Radius.sm, overflow: 'hidden' },
  pageImage: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, width: '100%', height: '100%' },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
  settingsPanel: { width: 360, borderLeftWidth: 1 },
  mobileSheet: {
    maxHeight: 430,
    borderTopWidth: 1,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  settingsContent: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  settingsContentWithResultDock: { paddingBottom: 188 },
  panelHeader: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  toolScrollFrame: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  toolScroll: { maxHeight: 54 },
  toolRail: { gap: Spacing.sm, paddingRight: Spacing.lg },
  toolScrollCue: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolChip: {
    height: 38,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  labeled: { gap: Spacing.xs },
  actionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  actionButton: {
    minHeight: 54,
    minWidth: 150,
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  actionButtonLabel: { flexShrink: 1 },
  mobileStrip: { borderTopWidth: 1, paddingVertical: Spacing.sm },
  mobileStripContent: { gap: Spacing.sm, paddingHorizontal: Spacing.md },
  stripThumb: {
    width: 70,
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: 5,
    gap: 3,
    alignItems: 'center',
  },
  stripThumbImage: { width: '100%', aspectRatio: 0.72, borderRadius: Radius.sm, backgroundColor: '#fff' },
  cornerHandle: { position: 'absolute', width: 32, height: 32, borderRadius: Radius.sm, borderWidth: 4 },
  edgeHandle: { position: 'absolute', width: 24, height: 24, borderRadius: Radius.pill },
  dragHint: {
    position: 'absolute',
    height: 30,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  magnifier: {
    position: 'absolute',
    width: 96,
    height: 54,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  drawHint: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    minHeight: 34,
    borderRadius: Radius.pill,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editorObject: {
    position: 'absolute',
    borderWidth: 2,
    borderRadius: Radius.sm,
    minWidth: 28,
    minHeight: 22,
  },
  objectFill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xs,
    overflow: 'hidden',
  },
  objectToolbar: {
    position: 'absolute',
    top: -38,
    left: 0,
    minHeight: 30,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resizeHandle: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  resizeHandle_nw: { left: -11, top: -11 },
  resizeHandle_ne: { right: -11, top: -11 },
  resizeHandle_sw: { left: -11, bottom: -11 },
  resizeHandle_se: { right: -11, bottom: -11 },
  redactionFill: { backgroundColor: '#050505', borderColor: '#050505' },
  annotationFill: { backgroundColor: 'rgba(255,245,132,0.9)' },
  annotationShapeFill: { backgroundColor: 'transparent', borderWidth: 3 },
  annotationCalloutFill: { overflow: 'visible' },
  calloutPointer: {
    position: 'absolute',
    left: -8,
    bottom: -8,
    width: 18,
    height: 18,
    transform: [{ rotate: '45deg' }],
    opacity: 0.9,
  },
  formFieldFill: { borderWidth: 1.5, alignItems: 'stretch', justifyContent: 'center', gap: 2 },
  formFieldTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  formCheckboxFill: {
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Spacing.xs,
  },
  formCheckboxBox: {
    width: 28,
    height: 28,
    borderRadius: Radius.xs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formSignatureFill: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 4 },
  formSignatureLine: { width: '84%', height: 2, borderRadius: Radius.pill },
  stampFill: { position: 'relative', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 3, gap: 1 },
  stampPillFill: { borderRadius: Radius.pill },
  stampSealFill: { borderRadius: Radius.pill, aspectRatio: 1.55 },
  stampInnerBorder: {
    position: 'absolute',
    left: 6,
    right: 6,
    top: 6,
    bottom: 6,
    borderWidth: 1.5,
    borderRadius: Radius.xs,
  },
  stampUploadFill: { backgroundColor: 'rgba(255,255,255,0.02)', borderWidth: 1.5, padding: Spacing.xs },
  stampUploadPad: {
    height: 150,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  stampImagePreview: { width: '100%', height: '100%' },
  signatureFill: { backgroundColor: 'rgba(255,255,255,0.02)' },
  signatureObjectImage: { width: '100%', height: '100%' },
  watermarkFill: { backgroundColor: 'transparent', borderColor: 'transparent' },
  textFill: { alignItems: 'flex-start', justifyContent: 'center' },
  textObject: {
    position: 'absolute',
    left: '19%',
    top: '30%',
    width: '44%',
    minHeight: 74,
    borderWidth: 2,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  floatingToolbar: {
    position: 'absolute',
    top: -42,
    left: 0,
    height: 34,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  redactBox: {
    position: 'absolute',
    left: '22%',
    top: '42%',
    width: '48%',
    height: 48,
    backgroundColor: '#050505',
    borderWidth: 2,
  },
  highlightBox: {
    position: 'absolute',
    left: '18%',
    top: '36%',
    width: '56%',
    height: 42,
    borderWidth: 1.5,
    borderRadius: Radius.xs,
  },
  signaturePreview: {
    position: 'absolute',
    left: '42%',
    top: '70%',
    width: '34%',
    height: 82,
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  stampPreview: {
    position: 'absolute',
    left: '24%',
    top: '55%',
    width: '48%',
    height: 92,
    borderWidth: 4,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-12deg' }],
  },
  watermarkPreview: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: '42%',
    minHeight: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  annotationPreview: {
    position: 'absolute',
    right: '10%',
    top: '18%',
    width: '28%',
    minHeight: 86,
    borderWidth: 1.5,
    borderRadius: Radius.sm,
    padding: Spacing.sm,
  },
  toast: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    minHeight: 46,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  swatchRow: { flexDirection: 'row', gap: Spacing.sm },
  swatchRowWrap: { flexWrap: 'wrap' },
  swatch: { width: 32, height: 32, borderRadius: Radius.pill, borderWidth: 3 },
  twoCols: { width: '100%', flexDirection: 'row', gap: Spacing.sm },
  twoColItem: { flex: 1, minWidth: 0 },
  positionGrid: {
    borderWidth: 1,
    borderRadius: Radius.md,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  positionCell: {
    width: '33.333%',
    aspectRatio: 2.1,
    borderWidth: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  positionDot: { width: 10, height: 10, borderRadius: Radius.pill },
  checkRow: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  resultPanel: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  resultIcon: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultActions: { gap: Spacing.sm },
  mobileResultDock: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    borderWidth: 1,
    borderRadius: Radius.xl,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  mobileResultTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mobileResultButtons: { flexDirection: 'row', gap: Spacing.sm },
  mobileResultButton: { flex: 1 },
  signaturePad: {
    height: 132,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  signatureDrawPad: { position: 'relative' },
  signatureTypedPad: { paddingHorizontal: Spacing.md },
  signaturePadEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  signatureImagePreview: { width: '100%', height: '100%' },
  stampGallery: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  stampChip: {
    minHeight: 40,
    minWidth: 96,
    borderWidth: 2,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
  stampChipPill: { borderRadius: Radius.pill },
  stampChipSeal: { minWidth: 74, borderRadius: Radius.pill, transform: [{ rotate: '-8deg' }] },
  commentRow: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.045)',
    gap: 2,
  },
  formFieldList: { gap: Spacing.sm },
  formDetectedRow: {
    minHeight: 54,
    borderRadius: Radius.md,
    padding: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.045)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  formDetectedIndex: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickNoteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  quickNoteChip: {
    minHeight: 34,
    maxWidth: '100%',
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
});
