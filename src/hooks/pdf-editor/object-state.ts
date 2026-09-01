import { splitDoodleObjectAt } from '@/lib/pdf-editor/doodle';
import { clampEditorObject } from '@/lib/pdf-editor/model';
import type { EditorObject, EditorOptions, EditorPoint } from '@/lib/pdf-editor/types';

export type EditorObjectPatch = Partial<EditorObject> | ((object: EditorObject) => EditorObject);

export function optionsForSelectedObject(previous: EditorOptions, object: EditorObject): EditorOptions {
  return {
    ...previous,
    text:
      object.type === 'text' || object.type === 'watermark' ? (object.text ?? previous.text) : previous.text,
    stampText: object.type === 'stamp' ? (object.text ?? previous.stampText) : previous.stampText,
    stampDetail:
      object.type === 'stamp' ? (object.stampDetail ?? previous.stampDetail) : previous.stampDetail,
    stampMode: object.type === 'stamp' ? (object.stampMode ?? previous.stampMode) : previous.stampMode,
    stampShape: object.type === 'stamp' ? (object.stampShape ?? previous.stampShape) : previous.stampShape,
    stampStyle: object.type === 'stamp' ? (object.stampStyle ?? previous.stampStyle) : previous.stampStyle,
    stampImageDataUrl:
      object.type === 'stamp'
        ? (object.stampImageDataUrl ?? previous.stampImageDataUrl)
        : previous.stampImageDataUrl,
    stampImageName:
      object.type === 'stamp' ? (object.stampImageName ?? previous.stampImageName) : previous.stampImageName,
    signatureText:
      object.type === 'signature' && (object.signatureMode ?? 'type') === 'type'
        ? (object.text ?? previous.signatureText)
        : previous.signatureText,
    annotationText:
      object.type === 'annotate' ? (object.text ?? previous.annotationText) : previous.annotationText,
    redactLabel: object.type === 'redact' ? (object.text ?? previous.redactLabel) : previous.redactLabel,
    color: object.color,
    opacity: String(Number(object.opacity.toFixed(2))),
    thickness: String(Number(object.thickness.toFixed(1))),
    fontSize: String(Number((object.fontSize ?? 14).toFixed(1))),
    signatureFontSize:
      object.type === 'signature'
        ? String(Number((object.fontSize ?? 24).toFixed(1)))
        : previous.signatureFontSize,
    rotation: String(Number(object.rotation.toFixed(1))),
    bold: Boolean(object.bold),
    italic: Boolean(object.italic),
    underline: Boolean(object.underline),
    align: object.align ?? previous.align,
    signatureMode:
      object.type === 'signature' ? (object.signatureMode ?? previous.signatureMode) : previous.signatureMode,
    signaturePoints:
      object.type === 'signature'
        ? (object.signaturePoints ?? previous.signaturePoints)
        : previous.signaturePoints,
    signaturePaths:
      object.type === 'signature'
        ? (object.signaturePaths ?? previous.signaturePaths)
        : previous.signaturePaths,
    signatureImageDataUrl:
      object.type === 'signature'
        ? (object.signatureImageDataUrl ?? previous.signatureImageDataUrl)
        : previous.signatureImageDataUrl,
    signatureImageName:
      object.type === 'signature'
        ? (object.signatureImageName ?? previous.signatureImageName)
        : previous.signatureImageName,
    formFieldKind:
      object.type === 'form-field'
        ? (object.formFieldKind ?? previous.formFieldKind)
        : previous.formFieldKind,
    formValue: object.type === 'form-field' ? (object.formValue ?? previous.formValue) : previous.formValue,
    formPlaceholder:
      object.type === 'form-field'
        ? (object.formPlaceholder ?? previous.formPlaceholder)
        : previous.formPlaceholder,
    formChecked: object.type === 'form-field' ? Boolean(object.formChecked) : previous.formChecked,
    formRequired: object.type === 'form-field' ? Boolean(object.formRequired) : previous.formRequired,
    annotationMode:
      object.type === 'annotate'
        ? (object.annotationMode ?? previous.annotationMode)
        : previous.annotationMode,
  };
}

export function patchObjectById(
  objects: EditorObject[],
  id: string,
  patch: EditorObjectPatch,
): EditorObject[] {
  return objects.map((object) => {
    if (object.id !== id) return object;
    const next = typeof patch === 'function' ? patch(object) : { ...object, ...patch };
    return clampEditorObject(next);
  });
}

export function eraseDoodlesFromPage(
  objects: EditorObject[],
  pageIndex: number,
  point: EditorPoint,
  radius = 0.035,
): EditorObject[] {
  return objects.flatMap((object) =>
    object.type === 'doodle' && object.pageIndex === pageIndex
      ? splitDoodleObjectAt(object, point, radius)
      : [object],
  );
}

export function offsetEditorObject(object: EditorObject, sameTypeCount: number): EditorObject {
  const offset = Math.min(0.24, sameTypeCount * 0.045);
  return clampEditorObject({
    ...object,
    x: object.x + offset,
    y: object.y + offset,
  });
}
