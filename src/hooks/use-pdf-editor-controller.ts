import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { findTool } from '@/constants/tools';
import { Accents } from '@/constants/theme';
import { DEFAULT_QUAD, EDITOR_TOOLS } from '@/lib/pdf-editor/constants';
import { cloneQuad, rectFromQuad, type ApplyScope, type CropQuad } from '@/lib/pdf-editor/geometry';
import { normalizeTool } from '@/lib/pdf-editor/model';
import type { CropMode, EditorToolId } from '@/lib/pdf-editor/types';
import { canShareFiles } from '@/lib/share';
import { selectIsPremium, useAuth } from '@/store/useAuth';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

import type { EditorToast } from './pdf-editor/types';
import { useEditorObjects } from './pdf-editor/use-editor-objects';
import { useEditorResult } from './pdf-editor/use-editor-result';
import { usePdfPreview } from './pdf-editor/use-pdf-preview';

export function usePdfEditorController(desktop: boolean, width: number) {
  const params = useLocalSearchParams<{ tool?: string; file?: string }>();
  const initialTool = normalizeTool(params.tool);
  const routeFileId = Array.isArray(params.file) ? params.file[0] : params.file;
  const [activeTool, setActiveTool] = useState<EditorToolId>(initialTool);
  const catalogTool = findTool(activeTool);
  const isPremium = useAuth(selectIsPremium);
  const routedFile = useLibrary((state) =>
    routeFileId ? state.files.find((item) => item.id === routeFileId) : undefined,
  );
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState<EditorToast | null>(null);
  const [cropMode, setCropMode] = useState<CropMode>('perspective');
  const [applyScope, setApplyScope] = useState<ApplyScope>('current');
  const [pageRange, setPageRange] = useState('1-3');
  const [quad, setQuad] = useState<CropQuad>(() => cloneQuad(DEFAULT_QUAD));
  const [beforeAfter, setBeforeAfter] = useState<'before' | 'after'>('after');
  const [cropDragging, setCropDragging] = useState(false);
  const preview = usePdfPreview();
  const editor = useEditorObjects({
    activeTool,
    file: preview.file,
    pageIndex: preview.pageIndex,
    pagesLength: preview.pages.length,
    setToast,
  });
  const tool = EDITOR_TOOLS[activeTool];
  const accent = Accents[tool.accent];
  const shareSupported = canShareFiles();
  const currentPage = preview.pages[preview.pageIndex];
  const pageCount = Math.max(1, preview.pages.length);
  const pageWidth = Math.max(280, Math.min(desktop ? width - 650 : width - 36, 760) * zoom);
  const canApply = Boolean(
    preview.file && preview.pages.length > 0 && !preview.rendering && !preview.renderError,
  );
  const result = useEditorResult({
    activeTool,
    toolTitle: tool.title,
    file: preview.file,
    canApply,
    objects: editor.objects,
    editorOptions: editor.editorOptions,
    applyScope,
    pageIndex: preview.pageIndex,
    pageCount,
    pageRange,
    quad,
    pageTotal: preview.pages.length,
    currentPageUri: currentPage?.uri,
    setToast,
  });
  const loadedRouteFileRef = useRef<string | null>(null);
  const { resetObjects } = editor;
  const { loadFile } = preview;

  const pickFile = useCallback(
    async (picked: FileItem) => {
      resetObjects();
      await loadFile(picked);
    },
    [loadFile, resetObjects],
  );

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!routedFile || routedFile.kind !== 'pdf' || loadedRouteFileRef.current === routedFile.id) {
      return;
    }
    loadedRouteFileRef.current = routedFile.id;
    void pickFile(routedFile);
  }, [pickFile, routedFile]);

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
    router: result.router,
    activeTool,
    setActiveTool,
    catalogTool,
    isPremium,
    file: preview.file,
    pages: preview.pages,
    pageIndex: preview.pageIndex,
    setPageIndex: preview.setPageIndex,
    rendering: preview.rendering,
    progress: preview.progress,
    renderError: preview.renderError,
    zoom,
    setZoom,
    toast,
    setToast,
    saving: result.saving,
    resultFile: result.resultFile,
    resultAction: result.resultAction,
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
    editorOptions: editor.editorOptions,
    setEditorOptions: editor.setEditorOptions,
    selectedObjectId: editor.selectedObjectId,
    canvasInteracting: editor.canvasInteracting,
    setCanvasInteracting: editor.setCanvasInteracting,
    tool,
    accent,
    shareSupported,
    currentPage,
    pageCount,
    pageWidth,
    canApply,
    pageObjects: editor.pageObjects,
    pickFile,
    selectEditorObject: editor.selectEditorObject,
    patchEditorObject: editor.patchEditorObject,
    addEditorObject: editor.addEditorObject,
    eraseDoodlesAt: editor.eraseDoodlesAt,
    addObjectForActiveTool: editor.addObjectForActiveTool,
    clearSelectedObject: editor.clearSelectedObject,
    applyPreview: result.applyPreview,
    downloadResult: result.downloadResult,
    shareResult: result.shareResult,
    previewResult: result.previewResult,
    resetCrop,
    makePerfect,
  };
}
