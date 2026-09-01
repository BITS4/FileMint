import { describe, expect, it } from 'vitest';

import { DEFAULT_EDITOR_OPTIONS } from '@/lib/pdf-editor/constants';
import type { EditorObject, EditorObjectType } from '@/lib/pdf-editor/types';

import {
  eraseDoodlesFromPage,
  offsetEditorObject,
  optionsForSelectedObject,
  patchObjectById,
} from './object-state';

function object(type: EditorObjectType, overrides: Partial<EditorObject> = {}): EditorObject {
  return {
    id: `${type}-1`,
    pageIndex: 0,
    type,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.1,
    color: '#123456',
    opacity: 0.876,
    thickness: 3.26,
    fontSize: 18.44,
    rotation: -7.55,
    ...overrides,
  };
}

describe('PDF editor controller object state', () => {
  it('loads text style and rounded numeric values into the inspector', () => {
    const next = optionsForSelectedObject(
      DEFAULT_EDITOR_OPTIONS,
      object('text', {
        text: 'Signed copy',
        bold: true,
        italic: true,
        underline: true,
        align: 'right',
      }),
    );

    expect(next).toMatchObject({
      text: 'Signed copy',
      color: '#123456',
      opacity: '0.88',
      thickness: '3.3',
      fontSize: '18.4',
      rotation: '-7.5',
      bold: true,
      italic: true,
      underline: true,
      align: 'right',
    });
    expect(next.stampText).toBe(DEFAULT_EDITOR_OPTIONS.stampText);
  });

  it('loads stamp, signature, annotation, and form-specific inspector values', () => {
    const stamp = optionsForSelectedObject(
      DEFAULT_EDITOR_OPTIONS,
      object('stamp', {
        text: 'PAID',
        stampDetail: 'Invoice 42',
        stampMode: 'upload',
        stampShape: 'seal',
        stampStyle: 'filled',
        stampImageDataUrl: 'data:image/png;base64,abc',
        stampImageName: 'paid.png',
      }),
    );
    expect(stamp).toMatchObject({
      stampText: 'PAID',
      stampDetail: 'Invoice 42',
      stampMode: 'upload',
      stampShape: 'seal',
      stampStyle: 'filled',
      stampImageName: 'paid.png',
    });

    const signature = optionsForSelectedObject(
      stamp,
      object('signature', {
        text: 'Ada',
        signatureMode: 'type',
        signaturePoints: [{ x: 0.2, y: 0.3 }],
        signaturePaths: [[{ x: 0.2, y: 0.3 }]],
        signatureImageName: 'signature.png',
      }),
    );
    expect(signature).toMatchObject({
      signatureText: 'Ada',
      signatureMode: 'type',
      signatureFontSize: '18.4',
      signatureImageName: 'signature.png',
    });
    expect(signature.signaturePoints).toEqual([{ x: 0.2, y: 0.3 }]);

    const annotation = optionsForSelectedObject(
      signature,
      object('annotate', { text: 'Check total', annotationMode: 'callout' }),
    );
    expect(annotation).toMatchObject({
      annotationText: 'Check total',
      annotationMode: 'callout',
    });

    const form = optionsForSelectedObject(
      annotation,
      object('form-field', {
        formFieldKind: 'checkbox',
        formValue: 'yes',
        formPlaceholder: 'Accept',
        formChecked: false,
        formRequired: true,
      }),
    );
    expect(form).toMatchObject({
      formFieldKind: 'checkbox',
      formValue: 'yes',
      formPlaceholder: 'Accept',
      formChecked: false,
      formRequired: true,
    });
  });

  it('uses inspector fallbacks when optional object metadata is absent', () => {
    const previous = {
      ...DEFAULT_EDITOR_OPTIONS,
      text: 'Previous watermark',
      stampText: 'OLD STAMP',
      stampDetail: 'Old detail',
      stampMode: 'upload' as const,
      stampShape: 'pill' as const,
      stampStyle: 'filled' as const,
      stampImageDataUrl: 'old-stamp-data',
      stampImageName: 'old-stamp.png',
      signatureText: 'Previous signer',
      signatureMode: 'upload' as const,
      signatureImageDataUrl: 'old-signature-data',
      signatureImageName: 'old-signature.png',
      annotationText: 'Previous note',
      annotationMode: 'shape' as const,
      redactLabel: 'Previous redaction',
      formFieldKind: 'date' as const,
      formValue: '2026-09-01',
      formPlaceholder: 'Previous field',
      formChecked: true,
      formRequired: true,
      align: 'center' as const,
    };

    const watermark = optionsForSelectedObject(
      previous,
      object('watermark', {
        text: undefined,
        fontSize: undefined,
        align: undefined,
        bold: undefined,
        italic: undefined,
        underline: undefined,
      }),
    );
    expect(watermark).toMatchObject({
      text: 'Previous watermark',
      fontSize: '14',
      align: 'center',
      bold: false,
      italic: false,
      underline: false,
    });

    expect(optionsForSelectedObject(previous, object('stamp'))).toMatchObject({
      stampText: 'OLD STAMP',
      stampDetail: 'Old detail',
      stampMode: 'upload',
      stampShape: 'pill',
      stampStyle: 'filled',
      stampImageDataUrl: 'old-stamp-data',
      stampImageName: 'old-stamp.png',
    });

    expect(
      optionsForSelectedObject(previous, object('signature', { signatureMode: 'draw', fontSize: undefined })),
    ).toMatchObject({
      signatureText: 'Previous signer',
      signatureMode: 'draw',
      signatureFontSize: '24',
      signatureImageDataUrl: 'old-signature-data',
      signatureImageName: 'old-signature.png',
    });

    expect(
      optionsForSelectedObject(previous, object('signature', { text: undefined, signatureMode: undefined })),
    ).toMatchObject({
      signatureText: 'Previous signer',
      signatureMode: 'upload',
    });

    expect(optionsForSelectedObject(previous, object('annotate'))).toMatchObject({
      annotationText: 'Previous note',
      annotationMode: 'shape',
    });
    expect(optionsForSelectedObject(previous, object('redact'))).toMatchObject({
      redactLabel: 'Previous redaction',
    });
    expect(optionsForSelectedObject(previous, object('form-field'))).toMatchObject({
      formFieldKind: 'date',
      formValue: '2026-09-01',
      formPlaceholder: 'Previous field',
      formChecked: false,
      formRequired: false,
    });

    const highlight = optionsForSelectedObject(previous, object('highlight'));
    expect(highlight).toMatchObject({
      text: 'Previous watermark',
      stampText: 'OLD STAMP',
      signatureText: 'Previous signer',
      annotationText: 'Previous note',
      redactLabel: 'Previous redaction',
    });
  });

  it('patches only the requested object and clamps direct and functional updates', () => {
    const first = object('text');
    const second = object('highlight', { id: 'highlight-2', pageIndex: 1 });

    const direct = patchObjectById([first, second], first.id, {
      x: 0.95,
      width: 0.4,
    });
    expect(direct[0]).toMatchObject({ x: 0.6, width: 0.4 });
    expect(direct[1]).toBe(second);

    const functional = patchObjectById(direct, first.id, (current) => ({
      ...current,
      y: -1,
      height: 2,
    }));
    expect(functional[0]).toMatchObject({ y: 0, height: 0.96 });
    expect(patchObjectById(functional, 'missing', { x: 0.5 })).toEqual(functional);
  });

  it('offsets repeated objects with a cap while keeping them on the page', () => {
    const repeated = offsetEditorObject(object('stamp'), 2);
    expect(repeated.x).toBeCloseTo(0.19);
    expect(repeated.y).toBeCloseTo(0.29);
    expect(
      offsetEditorObject(object('stamp', { x: 0.8, y: 0.9, width: 0.3, height: 0.2 }), 20),
    ).toMatchObject({ x: 0.7, y: 0.8 });
  });

  it('erases strokes only on the targeted page and preserves other objects', () => {
    const target = object('doodle', {
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
        { x: 0.95, y: 0.5 },
      ],
    });
    const otherPage = object('doodle', {
      id: 'page-2-stroke',
      pageIndex: 1,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
    });
    const text = object('text');

    const next = eraseDoodlesFromPage([target, otherPage, text], 0, { x: 0.5, y: 0.5 }, 0.05);
    expect(next.filter((item) => item.type === 'doodle' && item.pageIndex === 0)).toHaveLength(2);
    expect(next).toContain(otherPage);
    expect(next).toContain(text);
  });
});
