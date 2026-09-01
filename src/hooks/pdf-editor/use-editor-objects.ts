import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { DEFAULT_EDITOR_OPTIONS, EDITOR_TOOLS } from '@/lib/pdf-editor/constants';
import {
  clampEditorObject,
  defaultObjectForTool,
  editorObjectTypeForTool,
  syncObjectFromOptions,
} from '@/lib/pdf-editor/model';
import type { EditorObject, EditorOptions, EditorPoint, EditorToolId } from '@/lib/pdf-editor/types';
import type { FileItem } from '@/types';

import {
  eraseDoodlesFromPage,
  offsetEditorObject,
  optionsForSelectedObject,
  patchObjectById,
  type EditorObjectPatch,
} from './object-state';
import type { EditorToast } from './types';

interface UseEditorObjectsOptions {
  activeTool: EditorToolId;
  file: FileItem | null;
  pageIndex: number;
  pagesLength: number;
  setToast: Dispatch<SetStateAction<EditorToast | null>>;
}

export function useEditorObjects({
  activeTool,
  file,
  pageIndex,
  pagesLength,
  setToast,
}: UseEditorObjectsOptions) {
  const [editorOptions, setEditorOptions] = useState<EditorOptions>(() => ({
    ...DEFAULT_EDITOR_OPTIONS,
    signaturePoints: [],
    signaturePaths: [],
  }));
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const editorOptionsRef = useRef(editorOptions);
  editorOptionsRef.current = editorOptions;
  const pageObjects = useMemo(
    () => objects.filter((object) => object.pageIndex === pageIndex),
    [objects, pageIndex],
  );

  const resetObjects = useCallback(() => {
    setObjects([]);
    setSelectedObjectId(null);
  }, []);

  useEffect(() => {
    if (!file) resetObjects();
  }, [file, resetObjects]);

  useEffect(() => {
    const objectType = editorObjectTypeForTool(activeTool);
    if (!file || !pagesLength || !objectType) return;
    if (objectType === 'doodle') {
      setSelectedObjectId(null);
      return;
    }
    const nextObject = defaultObjectForTool(activeTool, pageIndex, editorOptionsRef.current);
    if (!nextObject) return;
    setObjects((previous) => {
      const existing = previous.find(
        (object) => object.pageIndex === pageIndex && object.type === objectType,
      );
      if (existing) {
        setSelectedObjectId(existing.id);
        return previous;
      }
      setSelectedObjectId(nextObject.id);
      return [...previous, nextObject];
    });
  }, [activeTool, file, pageIndex, pagesLength]);

  useEffect(() => {
    if (!selectedObjectId) return;
    setObjects((previous) =>
      previous.map((object) =>
        object.id === selectedObjectId ? syncObjectFromOptions(object, editorOptions) : object,
      ),
    );
  }, [editorOptions, selectedObjectId]);

  const selectEditorObject = (object: EditorObject) => {
    setSelectedObjectId(object.id);
    setEditorOptions((previous) => optionsForSelectedObject(previous, object));
  };

  const patchEditorObject = (id: string, patch: EditorObjectPatch) => {
    setObjects((previous) => patchObjectById(previous, id, patch));
  };

  const addEditorObject = (object: EditorObject) => {
    const next = clampEditorObject(object);
    setObjects((previous) => [...previous, next]);
    if (next.type === 'doodle') {
      setSelectedObjectId(null);
      return;
    }
    selectEditorObject(next);
  };

  const eraseDoodlesAt = (targetPageIndex: number, point: EditorPoint, radius = 0.035) => {
    setObjects((previous) => eraseDoodlesFromPage(previous, targetPageIndex, point, radius));
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
    if (optionOverrides) setEditorOptions((previous) => ({ ...previous, ...optionOverrides }));
    addEditorObject(offsetEditorObject(object, sameTypeCount));
    setToast({ tone: 'success', text: `${EDITOR_TOOLS[activeTool].title} box added` });
  };

  const clearSelectedObject = () => setSelectedObjectId(null);

  return {
    editorOptions,
    setEditorOptions,
    objects,
    selectedObjectId,
    canvasInteracting,
    setCanvasInteracting,
    pageObjects,
    resetObjects,
    selectEditorObject,
    patchEditorObject,
    addEditorObject,
    eraseDoodlesAt,
    addObjectForActiveTool,
    clearSelectedObject,
  };
}
