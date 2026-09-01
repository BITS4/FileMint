import { describe, expect, it } from 'vitest';

import { DEFAULT_EDITOR_OPTIONS } from './constants';
import {
  canUsePdfEditorTool,
  clampEditorObject,
  clampUnit,
  defaultObjectForTool,
  editorObjectTypeForTool,
  editorToolTitle,
  exportEditorObjects,
  makeObjectId,
  normalizeTool,
  objectTextForType,
  redactionAreasFromObjects,
  syncObjectFromOptions,
} from './model';
import type { EditorObject } from './types';

const baseObject: EditorObject = {
  id: 'object-1',
  pageIndex: 2,
  type: 'text',
  x: 0.2,
  y: 0.3,
  width: 0.4,
  height: 0.08,
  color: '#111827',
  opacity: 0.8,
  thickness: 2,
  rotation: 0,
};

describe('PDF editor model', () => {
  it('normalizes route params and rejects unknown tools', () => {
    expect(normalizeTool(['add-text'])).toBe('add-text');
    expect(normalizeTool('not-a-tool')).toBe('crop-pdf');
    expect(editorObjectTypeForTool('flatten')).toBeNull();
    expect(editorObjectTypeForTool('fill-forms')).toBe('form-field');
    expect(canUsePdfEditorTool('redact')).toBe(true);
    expect(canUsePdfEditorTool('crop-pdf')).toBe(false);
    expect(editorToolTitle('add-text')).toBe('Add Text');
  });

  it('creates deterministic, namespaced object ids when inputs are supplied', () => {
    expect(makeObjectId(35, 0.5)).toBe('editor_z_i');
  });

  it('clamps object dimensions and coordinates to the page', () => {
    const clamped = clampEditorObject({ ...baseObject, x: 0.95, y: -4, width: 2, height: 0 });
    expect(clamped.x).toBeCloseTo(0.04);
    expect(clamped).toMatchObject({ y: 0, width: 0.96, height: 0.025 });
    expect(clampUnit(Number.NaN, 0.2, 0.8)).toBe(0.2);
    expect(clampUnit(-2, 0.2, 0.8)).toBe(0.2);
    expect(clampUnit(2, 0.2, 0.8)).toBe(0.8);
  });

  it('builds typed objects with tool-specific defaults', () => {
    const signature = defaultObjectForTool('add-signature', 4, {
      ...DEFAULT_EDITOR_OPTIONS,
      signatureMode: 'type',
      signatureText: 'Ada',
      signatureFontSize: '30',
    });
    expect(signature).toMatchObject({
      pageIndex: 4,
      type: 'signature',
      text: 'Ada',
      fontSize: 30,
      signatureMode: 'type',
    });
    expect(defaultObjectForTool('doodle', 0, DEFAULT_EDITOR_OPTIONS)).toBeNull();
    expect(defaultObjectForTool('crop-pdf', 0, DEFAULT_EDITOR_OPTIONS)).toBeNull();

    const cases = [
      ['add-text', 'text'],
      ['add-watermark', 'watermark'],
      ['add-stamp', 'stamp'],
      ['highlight', 'highlight'],
      ['annotate', 'annotate'],
      ['redact', 'redact'],
      ['fill-forms', 'form-field'],
    ] as const;
    for (const [tool, type] of cases) {
      expect(defaultObjectForTool(tool, 1, DEFAULT_EDITOR_OPTIONS)).toMatchObject({
        pageIndex: 1,
        type,
      });
    }

    expect(
      defaultObjectForTool('fill-forms', 0, {
        ...DEFAULT_EDITOR_OPTIONS,
        formFieldKind: 'checkbox',
      }),
    ).toMatchObject({ width: 0.09, height: 0.045, formFieldKind: 'checkbox' });
  });

  it('uses readable fallbacks for empty editor content', () => {
    expect(objectTextForType('watermark', { ...DEFAULT_EDITOR_OPTIONS, text: '' })).toBe('CONFIDENTIAL');
    expect(
      objectTextForType('stamp', {
        ...DEFAULT_EDITOR_OPTIONS,
        stampMode: 'upload',
        stampImageName: undefined,
      }),
    ).toBe('Uploaded stamp');
    expect(
      objectTextForType('signature', {
        ...DEFAULT_EDITOR_OPTIONS,
        signatureMode: 'upload',
        signatureImageName: 'signature.png',
      }),
    ).toBe('signature.png');
    expect(objectTextForType('signature', { ...DEFAULT_EDITOR_OPTIONS, signatureMode: 'draw' })).toBe(
      'Drawn signature',
    );
    expect(objectTextForType('annotate', { ...DEFAULT_EDITOR_OPTIONS, annotationText: '' })).toBe(
      'Review note',
    );
    expect(objectTextForType('redact', { ...DEFAULT_EDITOR_OPTIONS, redactLabel: '' })).toBe('Redacted');
    expect(
      objectTextForType('form-field', {
        ...DEFAULT_EDITOR_OPTIONS,
        formValue: '',
        formPlaceholder: '',
      }),
    ).toBe('Form field');
  });

  it('syncs editable properties while preserving doodle strokes', () => {
    const updated = syncObjectFromOptions(baseObject, {
      ...DEFAULT_EDITOR_OPTIONS,
      text: 'Updated',
      opacity: '0.4',
      bold: true,
    });
    expect(updated).toMatchObject({ text: 'Updated', opacity: 0.4, bold: true });

    const doodle: EditorObject = { ...baseObject, type: 'doodle', points: [{ x: 0, y: 0 }] };
    expect(syncObjectFromOptions(doodle, DEFAULT_EDITOR_OPTIONS)).toBe(doodle);
  });

  it('syncs tool-specific object metadata', () => {
    const options = {
      ...DEFAULT_EDITOR_OPTIONS,
      color: '#123456',
      stampText: 'FINAL',
      stampDetail: 'LOCKED',
      stampMode: 'upload' as const,
      stampImageName: 'stamp.png',
      signatureMode: 'upload' as const,
      signatureImageName: 'sign.png',
      annotationMode: 'callout' as const,
      formFieldKind: 'date' as const,
      formValue: '2026-09-01',
      formRequired: true,
    };
    const types = ['stamp', 'signature', 'highlight', 'annotate', 'redact', 'form-field'] as const;
    for (const type of types) {
      const synced = syncObjectFromOptions({ ...baseObject, type }, options);
      expect(synced.type).toBe(type);
      expect(synced.x).toBeGreaterThanOrEqual(0);
    }
    expect(syncObjectFromOptions({ ...baseObject, type: 'stamp' }, options)).toMatchObject({
      text: 'stamp.png',
      stampDetail: 'LOCKED',
      stampMode: 'upload',
      stampImageName: 'stamp.png',
    });
    expect(syncObjectFromOptions({ ...baseObject, type: 'form-field' }, options)).toMatchObject({
      formFieldKind: 'date',
      formValue: '2026-09-01',
      formRequired: true,
    });
  });

  it('exports editor objects without internal ids', () => {
    const [exported] = exportEditorObjects([baseObject]);
    expect(exported).not.toHaveProperty('id');
    expect(exported).toMatchObject({ pageIndex: 2, type: 'text', x: 0.2 });
  });

  it('derives redaction boxes or safe page fallbacks', () => {
    expect(redactionAreasFromObjects([], [0, 3])).toEqual([
      { page: 0, x: 0.22, y: 0.42, width: 0.48, height: 0.07 },
      { page: 3, x: 0.22, y: 0.42, width: 0.48, height: 0.07 },
    ]);
    expect(redactionAreasFromObjects([{ ...baseObject, type: 'redact', x: 0.1, width: 0.5 }], [0])).toEqual([
      { page: 2, x: 0.1, y: 0.3, width: 0.5, height: 0.08 },
    ]);
  });
});
