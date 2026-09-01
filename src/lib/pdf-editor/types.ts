import type { Accents } from '@/constants/theme';

export type EditorToolId =
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

export type CropMode = 'free' | 'rectangle' | 'perspective';

export interface EditorOptions {
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

export type EditorObjectType =
  | 'text'
  | 'watermark'
  | 'stamp'
  | 'signature'
  | 'doodle'
  | 'highlight'
  | 'annotate'
  | 'redact'
  | 'form-field';

export interface EditorPoint {
  x: number;
  y: number;
}

export interface EditorObject {
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

export interface PreviewPage {
  index: number;
  uri: string;
}

export interface ToolMeta {
  id: EditorToolId;
  title: string;
  subtitle: string;
  icon: string;
  accent: keyof typeof Accents;
}
