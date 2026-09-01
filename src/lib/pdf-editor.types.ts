export type PdfEditorTool =
  | 'doodle'
  | 'highlight'
  | 'add-stamp'
  | 'add-signature'
  | 'flatten'
  | 'add-watermark'
  | 'annotate'
  | 'redact'
  | 'add-text'
  | 'add-page-numbers'
  | 'fill-forms';

export interface PdfEditorExportOptions {
  tool: PdfEditorTool;
  targetPages: number[];
  text?: string;
  stampText?: string;
  stampDetail?: string;
  stampMode?: 'design' | 'upload';
  stampShape?: 'box' | 'pill' | 'seal';
  stampStyle?: 'outline' | 'filled' | 'double';
  stampImageDataUrl?: string;
  stampImageName?: string;
  signatureText?: string;
  annotationText?: string;
  redactLabel?: string;
  color?: string;
  opacity?: number;
  thickness?: number;
  fontSize?: number;
  rotation?: number;
}

export type PdfEditorObjectType =
  | 'text'
  | 'watermark'
  | 'stamp'
  | 'signature'
  | 'doodle'
  | 'highlight'
  | 'annotate'
  | 'redact'
  | 'form-field';

export interface PdfEditorObjectExport {
  type: PdfEditorObjectType;
  pageIndex: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  text?: string;
  color?: string;
  opacity?: number;
  thickness?: number;
  fontSize?: number;
  rotation?: number;
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
  signaturePoints?: { x: number; y: number }[];
  signaturePaths?: { x: number; y: number }[][];
  signatureImageDataUrl?: string;
  signatureImageName?: string;
  formFieldKind?: 'text' | 'checkbox' | 'date' | 'signature' | 'initials';
  formValue?: string;
  formPlaceholder?: string;
  formChecked?: boolean;
  formRequired?: boolean;
  doodleMode?: 'pencil' | 'marker' | 'eraser' | 'vector' | 'arrow';
  annotationMode?: 'note' | 'callout' | 'shape';
  points?: { x: number; y: number }[];
}
