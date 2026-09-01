import { useCallback, useState } from 'react';

import { imageToUri, renderWithServer, withTimeout } from '@/lib/pdf-editor/preview';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';
import type { PreviewPage } from '@/lib/pdf-editor/types';

export function usePdfPreview() {
  const [file, setFile] = useState<FileItem | null>(null);
  const [pages, setPages] = useState<PreviewPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderError, setRenderError] = useState<string | null>(null);

  const loadFile = useCallback(async (picked: FileItem) => {
    setFile(picked);
    setPages([]);
    setPageIndex(0);
    setRendering(true);
    setProgress(0.08);
    setRenderError(null);
    try {
      const bytes = await storage.readBytes(picked.storageKey);
      let rendered: RenderedImage[];
      try {
        rendered = await withTimeout(
          renderPdfToImages(new Uint8Array(bytes), 'jpg', 1.2, (value) =>
            setProgress(Math.min(0.78, value * 0.78)),
          ),
          4500,
          'Browser renderer timed out.',
        );
      } catch {
        setProgress(0.82);
        rendered = await renderWithServer(picked);
      }
      setPages(rendered.map((image, index) => ({ index, uri: imageToUri(image) })));
      setProgress(1);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'Could not render this PDF.');
    } finally {
      setRendering(false);
    }
  }, []);

  return {
    file,
    pages,
    pageIndex,
    setPageIndex,
    rendering,
    progress,
    renderError,
    loadFile,
  };
}
