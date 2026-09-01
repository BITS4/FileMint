import { parsePositiveNumber } from '@/lib/pdf-editor/geometry';
import type { PdfEditorObjectExport, PdfEditorTool } from '@/lib/pdf';

import { EDITOR_TOOLS, FORM_FIELD_PRESETS, TOOL_IDS } from './constants';
import type { EditorObject, EditorObjectType, EditorOptions, EditorToolId } from './types';

export function normalizeTool(value: unknown): EditorToolId {
  const raw = Array.isArray(value) ? value[0] : value;
  return TOOL_IDS.includes(raw as EditorToolId) ? (raw as EditorToolId) : 'crop-pdf';
}

export function redactionAreas(targetPages: number[]) {
  return targetPages.map((page) => ({ page, x: 0.22, y: 0.42, width: 0.48, height: 0.07 }));
}

export function canUsePdfEditorTool(tool: EditorToolId): tool is PdfEditorTool {
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

export function editorObjectTypeForTool(tool: EditorToolId): EditorObjectType | null {
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

export function makeObjectId(now = Date.now(), random = Math.random()) {
  return `editor_${now.toString(36)}_${random.toString(36).slice(2, 8)}`;
}

export function clampUnit(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampEditorObject(object: EditorObject): EditorObject {
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

export function objectTextForType(type: EditorObjectType, options: EditorOptions) {
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

export function defaultObjectForTool(
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

export function syncObjectFromOptions(object: EditorObject, options: EditorOptions): EditorObject {
  if (object.type === 'doodle') return object;
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

export function exportEditorObjects(objects: EditorObject[]): PdfEditorObjectExport[] {
  return objects.map(({ id: _id, ...object }) => object);
}

export function redactionAreasFromObjects(objects: EditorObject[], fallbackPages: number[]) {
  const redactions = objects.filter((object) => object.type === 'redact');
  if (!redactions.length) return redactionAreas(fallbackPages);
  return redactions.map(({ pageIndex: page, x, y, width, height }) => ({ page, x, y, width, height }));
}

export function editorToolTitle(tool: EditorToolId) {
  return EDITOR_TOOLS[tool].title;
}
