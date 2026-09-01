import type { SegmentedOption } from '@/components/ui';
import type { ApplyScope, CropQuad } from '@/lib/pdf-editor/geometry';

import type { CropMode, EditorOptions, EditorToolId, ToolMeta } from './types';

export const EDITOR_TOOLS: Record<EditorToolId, ToolMeta> = {
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
    subtitle: 'Add text, checks, dates, initials, and signatures',
    icon: 'form-select',
    accent: 'blue',
  },
};

export const TOOL_IDS = Object.keys(EDITOR_TOOLS) as EditorToolId[];
export const DEFAULT_QUAD: CropQuad = {
  tl: { x: 0.14, y: 0.12 },
  tr: { x: 0.86, y: 0.12 },
  br: { x: 0.86, y: 0.88 },
  bl: { x: 0.14, y: 0.88 },
};
export const WEB_GESTURE_STYLE = { touchAction: 'none', userSelect: 'none' } as never;
export const CROP_MODE_OPTIONS: SegmentedOption<CropMode>[] = [
  { label: 'Free', value: 'free' },
  { label: 'Rectangle', value: 'rectangle' },
  { label: 'Perspective', value: 'perspective' },
];
export const APPLY_OPTIONS: SegmentedOption<ApplyScope>[] = [
  { label: 'Current', value: 'current' },
  { label: 'Selected', value: 'selected' },
  { label: 'Range', value: 'range' },
  { label: 'All', value: 'all' },
];
export const TEXT_COLOR_SWATCHES = [
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
export const DOODLE_COLOR_SWATCHES = [
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
export const SIGNATURE_COLOR_SWATCHES = [
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
export const STAMP_COLOR_SWATCHES = [
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
export const STAMP_TEMPLATES: Array<{
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
export const FORM_FIELD_PRESETS: Array<{
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
export const ANNOTATE_COLOR_SWATCHES = [
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

export const DEFAULT_EDITOR_OPTIONS: EditorOptions = {
  text: 'Editable text',
  stampText: 'APPROVED',
  stampDetail: 'VERIFIED',
  stampMode: 'design',
  stampShape: 'box',
  stampStyle: 'double',
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
  formFieldKind: 'text',
  formValue: '',
  formPlaceholder: 'Type here',
  formChecked: true,
  formRequired: false,
  doodleMode: 'pencil',
  annotationMode: 'note',
};
