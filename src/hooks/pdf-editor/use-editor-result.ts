import { useRouter } from 'expo-router';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { convertFile } from '@/lib/api';
import { confirm } from '@/lib/confirm';
import { baseName } from '@/lib/format';
import {
  cropEdgesFromQuad,
  parsePositiveNumber,
  targetPagesForScope,
  type ApplyScope,
  type CropQuad,
} from '@/lib/pdf-editor/geometry';
import {
  canUsePdfEditorTool,
  defaultObjectForTool,
  editorObjectTypeForTool,
  exportEditorObjects,
  redactionAreasFromObjects,
} from '@/lib/pdf-editor/model';
import type { EditorObject, EditorOptions, EditorToolId } from '@/lib/pdf-editor/types';
import { applyPdfEditorObjects, applyPdfEditorTool, cropPdfEdges } from '@/lib/pdf';
import { downloadFile, shareFile } from '@/lib/share';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

import type { EditorToast } from './types';

interface UseEditorResultOptions {
  activeTool: EditorToolId;
  toolTitle: string;
  file: FileItem | null;
  canApply: boolean;
  objects: EditorObject[];
  editorOptions: EditorOptions;
  applyScope: ApplyScope;
  pageIndex: number;
  pageCount: number;
  pageRange: string;
  quad: CropQuad;
  pageTotal: number;
  currentPageUri?: string;
  setToast: Dispatch<SetStateAction<EditorToast | null>>;
}

export function useEditorResult({
  activeTool,
  toolTitle,
  file,
  canApply,
  objects,
  editorOptions,
  applyScope,
  pageIndex,
  pageCount,
  pageRange,
  quad,
  pageTotal,
  currentPageUri,
  setToast,
}: UseEditorResultOptions) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [resultFile, setResultFile] = useState<FileItem | null>(null);
  const [resultAction, setResultAction] = useState<'download' | 'share' | null>(null);

  useEffect(() => {
    setResultFile(null);
  }, [activeTool, file?.id]);

  useEffect(() => {
    setResultFile(null);
  }, [objects, quad]);

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
          const response = await convertFile({
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
            ? await applyPdfEditorObjects(response.bytes, exportEditorObjects(remainingObjects))
            : response.bytes;
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
        if (exportObjects.length) {
          output = await applyPdfEditorObjects(output, exportEditorObjects(exportObjects));
        }
      } else if (canUsePdfEditorTool(activeTool)) {
        output = exportObjects.length
          ? await applyPdfEditorObjects(bytes, exportEditorObjects(exportObjects))
          : bytes;
      } else {
        output = bytes;
      }

      const saved = await useLibrary.getState().saveResult({
        bytes: output,
        name: `${baseName(file.name)} ${toolTitle}.pdf`,
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        source: 'created',
        pageCount: pageTotal || undefined,
        thumbnailUri: currentPageUri,
      });
      setResultFile(saved);
      setToast({ tone: 'success', text: `${toolTitle} PDF is ready` });
    } catch (error) {
      setToast({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Could not prepare the result',
      });
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
    if (resultFile) router.push(`/viewer/${resultFile.id}` as never);
  };

  return {
    router,
    saving,
    resultFile,
    resultAction,
    applyPreview,
    downloadResult,
    shareResult,
    previewResult,
  };
}
