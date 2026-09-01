import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findTool } from '@/constants/tools';
import { Accents } from '@/constants/theme';
import { convertFile } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { baseName } from '@/lib/format';
import {
  cloneQuad,
  cropEdgesFromQuad,
  parsePositiveNumber,
  rectFromQuad,
  targetPagesForScope,
  type ApplyScope,
  type CropQuad,
} from '@/lib/pdf-editor/geometry';
import { applyPdfEditorObjects, applyPdfEditorTool, cropPdfEdges } from '@/lib/pdf';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import { canShareFiles, downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { selectIsPremium, useAuth } from '@/store/useAuth';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';
import { DEFAULT_EDITOR_OPTIONS, DEFAULT_QUAD, EDITOR_TOOLS } from '@/lib/pdf-editor/constants';
import { splitDoodleObjectAt } from '@/lib/pdf-editor/doodle';
import {
  canUsePdfEditorTool,
  clampEditorObject,
  defaultObjectForTool,
  editorObjectTypeForTool,
  exportEditorObjects,
  normalizeTool,
  redactionAreasFromObjects,
  syncObjectFromOptions,
} from '@/lib/pdf-editor/model';
import { imageToUri, renderWithServer, withTimeout } from '@/lib/pdf-editor/preview';
import type {
  CropMode,
  EditorObject,
  EditorOptions,
  EditorPoint,
  EditorToolId,
  PreviewPage,
} from '@/lib/pdf-editor/types';

export function usePdfEditorController(desktop: boolean, width: number) {
  const router = useRouter();
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
  const [editorOptions, setEditorOptions] = useState<EditorOptions>(() => ({
    ...DEFAULT_EDITOR_OPTIONS,
    signaturePoints: [],
    signaturePaths: [],
  }));
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

  return {
    router,
    activeTool,
    setActiveTool,
    catalogTool,
    isPremium,
    file,
    pages,
    pageIndex,
    setPageIndex,
    rendering,
    progress,
    renderError,
    zoom,
    setZoom,
    toast,
    setToast,
    saving,
    resultFile,
    resultAction,
    cropMode,
    setCropMode,
    applyScope,
    setApplyScope,
    pageRange,
    setPageRange,
    quad,
    setQuad,
    beforeAfter,
    setBeforeAfter,
    cropDragging,
    setCropDragging,
    editorOptions,
    setEditorOptions,
    selectedObjectId,
    canvasInteracting,
    setCanvasInteracting,
    tool,
    accent,
    shareSupported,
    currentPage,
    pageCount,
    pageWidth,
    canApply,
    pageObjects,
    pickFile,
    selectEditorObject,
    patchEditorObject,
    addEditorObject,
    eraseDoodlesAt,
    addObjectForActiveTool,
    clearSelectedObject,
    applyPreview,
    downloadResult,
    shareResult,
    previewResult,
    resetCrop,
    makePerfect,
  };
}
