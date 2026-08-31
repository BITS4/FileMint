import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';

import { findTool } from '@/constants/tools';
import { dataUrl } from '@/lib/base64';
import {
  buildReport,
  clampPercent,
  cloneBytes,
  cloneQuad,
  cropFromQuad,
  cropIsActive,
  DEFAULT_QUAD,
  formatPercent,
  normalizeProfile,
  outputPageBoxForRaster,
  pickTypes,
  pngSize,
  PROFILE_TOOL_IDS,
  quadFromCrop,
  quadIsAxisAligned,
  quadIsDefault,
  SUPPORTED_EXTS,
  supportsProfile,
  type CropQuad,
  type ExportMode,
  type FilterId,
  type MarginKey,
  type OrientationChoice,
  type PageSizeChoice,
  type Quality,
  type Rotation,
  type SourceDoc,
  type StudioPage,
} from '@/lib/convert-to-pdf/model';
import { editedPreviewImage, renderPages, sourcePdfFromFile } from '@/lib/convert-to-pdf/rendering';
import { baseName, extFromName, withExt } from '@/lib/format';
import {
  cropPdfEdges,
  extractPages,
  getPdfPageSize,
  imageToPdfPage,
  mergePdfs,
  optimizePdf,
  rotatePages,
} from '@/lib/pdf';
import { importIntoLibrary, pickDocuments } from '@/lib/pick';
import { uid } from '@/lib/uid';
import { selectIsPremium, useAuth } from '@/store/useAuth';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem } from '@/types';

import { useIsDesktop } from './use-breakpoint';
import { useRunner } from './use-runner';
import { useTheme } from './use-theme';

export function useConvertToPdfStudio() {
  const params = useLocalSearchParams<{ profile?: string }>();
  const profile = normalizeProfile(params.profile);
  const theme = useTheme();
  const desktop = useIsDesktop();
  const runner = useRunner();
  const isPremium = useAuth(selectIsPremium);
  const profileTool = findTool(PROFILE_TOOL_IDS[profile]);

  const [files, setFiles] = useState<FileItem[]>([]);
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [pages, setPages] = useState<StudioPage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [prepareProgress, setPrepareProgress] = useState(0);
  const [fileName, setFileName] = useState('Converted document');
  const [pageSize, setPageSize] = useState<PageSizeChoice>('auto');
  const [orientation, setOrientation] = useState<OrientationChoice>('auto');
  const [margin, setMargin] = useState<MarginKey>('none');
  const [quality, setQuality] = useState<Quality>('high');
  const [exportMode, setExportMode] = useState<ExportMode>(profile === 'batch' ? 'separate' : 'merge');
  const [csvDelimiter, setCsvDelimiter] = useState(',');
  const [textFontSize, setTextFontSize] = useState('11');
  const [cropTop, setCropTop] = useState('0');
  const [cropRight, setCropRight] = useState('0');
  const [cropBottom, setCropBottom] = useState('0');
  const [cropLeft, setCropLeft] = useState('0');
  const [fullscreen, setFullscreen] = useState(false);

  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedId) ?? pages[0],
    [pages, selectedId],
  );
  const selectedIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === selectedPage?.id),
  );
  const includedCount = pages.filter((page) => page.included).length;
  const filterCount = pages.filter((page) => page.filter !== 'original').length;
  const cropCount = pages.filter((page) => cropIsActive(page.crop)).length;
  const freeCropCount = pages.filter(
    (page) => !quadIsDefault(page.quad) && !quadIsAxisAligned(page.quad),
  ).length;

  const prepareFiles = async (nextFiles: FileItem[]) => {
    setPreparing(true);
    setPrepareError(null);
    setPrepareProgress(0);
    try {
      const nextSources: SourceDoc[] = [];
      const nextPages: StudioPage[] = [];
      for (let index = 0; index < nextFiles.length; index++) {
        const file = nextFiles[index];
        setPrepareProgress(index / Math.max(1, nextFiles.length));
        const { bytes, report } = await sourcePdfFromFile(file, {
          pageSize,
          orientation,
          margin,
          csvDelimiter,
          textFontSize,
        });
        const sourceBytes = cloneBytes(bytes);
        const sourceId = uid('src_');
        const rendered = await renderPages(cloneBytes(bytes), (progress) => {
          setPrepareProgress((index + progress * 0.8) / Math.max(1, nextFiles.length));
        });
        nextSources.push({ id: sourceId, file, pdfBytes: sourceBytes, pageCount: rendered.length, report });
        const pageSizes = await Promise.all(
          rendered.map((_, pageIndex) =>
            getPdfPageSize(sourceBytes, pageIndex).catch(() => ({ width: 595.28, height: 841.89 })),
          ),
        );
        rendered.forEach((image, pageIndex) => {
          const { width, height } = pngSize(image.bytes);
          const pageBox = pageSizes[pageIndex] ?? { width: width || 595.28, height: height || 841.89 };
          nextPages.push({
            id: uid('page_'),
            sourceId,
            fileId: file.id,
            fileName: file.name,
            fileKind: file.kind,
            sourceIndex: pageIndex,
            previewBytes: image.bytes,
            previewUri: dataUrl('image/png', image.bytes),
            previewWidth: width,
            previewHeight: height,
            pageWidthPt: pageBox.width,
            pageHeightPt: pageBox.height,
            included: true,
            rotation: 0,
            filter: 'original',
            crop: { top: 0, right: 0, bottom: 0, left: 0 },
            quad: cloneQuad(DEFAULT_QUAD),
          });
        });
      }
      setSources(nextSources);
      setPages(nextPages);
      setSelectedId(nextPages[0]?.id ?? null);
      setFullscreen(nextPages.length > 0);
      if (nextFiles.length === 1) setFileName(baseName(nextFiles[0].name));
      else if (nextFiles.length > 1) setFileName('Merged PDF');
      setPrepareProgress(1);
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : 'Could not prepare the PDF preview.');
    } finally {
      setPreparing(false);
    }
  };

  const pickFiles = async () => {
    const picked = await pickDocuments({ multiple: true, type: pickTypes(profile) });
    if (!picked.length) return;
    const imported: FileItem[] = [];
    for (const item of picked) {
      const ext = extFromName(item.name);
      if (!SUPPORTED_EXTS.has(ext)) continue;
      const file = await importIntoLibrary(item, 'import');
      if (supportsProfile(file, profile)) imported.push(file);
    }
    if (!imported.length) {
      setPrepareError('Choose Word, PowerPoint, Excel, image, CSV, or text files with supported extensions.');
      return;
    }
    const next = [...files, ...imported];
    setFiles(next);
    await prepareFiles(next);
  };

  const rebuildPreview = () => {
    if (!files.length || preparing) return;
    void prepareFiles(files);
  };

  const updatePage = (id: string, patch: Partial<StudioPage>) => {
    setPages((previous) => previous.map((page) => (page.id === id ? { ...page, ...patch } : page)));
  };

  const selectPage = (page: StudioPage) => {
    setSelectedId(page.id);
    setCropTop(formatPercent(page.crop.top));
    setCropRight(formatPercent(page.crop.right));
    setCropBottom(formatPercent(page.crop.bottom));
    setCropLeft(formatPercent(page.crop.left));
  };

  const selectPageByIndex = (index: number) => {
    const page = pages[Math.max(0, Math.min(pages.length - 1, index))];
    if (page) selectPage(page);
  };

  const goToAdjacentPage = (direction: -1 | 1) => {
    if (!pages.length) return;
    selectPageByIndex(selectedIndex + direction);
  };

  const updatePageQuad = (id: string, quad: CropQuad) => {
    const crop = cropFromQuad(quad);
    if (id === selectedPage?.id) {
      setCropTop(formatPercent(crop.top));
      setCropRight(formatPercent(crop.right));
      setCropBottom(formatPercent(crop.bottom));
      setCropLeft(formatPercent(crop.left));
    }
    setPages((previous) => previous.map((page) => (page.id === id ? { ...page, quad, crop } : page)));
  };

  const updateCurrentCrop = (all: boolean) => {
    const crop = {
      top: clampPercent(cropTop),
      right: clampPercent(cropRight),
      bottom: clampPercent(cropBottom),
      left: clampPercent(cropLeft),
    };
    const quad = quadFromCrop(crop);
    setPages((previous) =>
      previous.map((page) => (all || page.id === selectedPage?.id ? { ...page, crop, quad } : page)),
    );
  };

  const resetCrop = (all: boolean) => {
    setCropTop('0');
    setCropRight('0');
    setCropBottom('0');
    setCropLeft('0');
    setPages((previous) =>
      previous.map((page) =>
        all || page.id === selectedPage?.id
          ? { ...page, crop: { top: 0, right: 0, bottom: 0, left: 0 }, quad: cloneQuad(DEFAULT_QUAD) }
          : page,
      ),
    );
  };

  const movePage = (id: string, direction: -1 | 1) => {
    setPages((previous) => {
      const index = previous.findIndex((page) => page.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= previous.length) return previous;
      const copy = [...previous];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  };

  const rotateCurrent = () => {
    if (!selectedPage) return;
    const next = ((selectedPage.rotation + 90) % 360) as Rotation;
    updatePage(selectedPage.id, { rotation: next });
  };

  const applyFilter = (filter: FilterId, all: boolean) => {
    setPages((previous) =>
      previous.map((page) => (all || page.id === selectedPage?.id ? { ...page, filter } : page)),
    );
  };

  const makePagePdf = async (page: StudioPage): Promise<Uint8Array> => {
    const source = sources.find((item) => item.id === page.sourceId);
    if (!source) throw new Error(`Missing source for ${page.fileName}.`);
    let bytes = await extractPages(source.pdfBytes, [page.sourceIndex]);
    if (page.rotation) bytes = await rotatePages(bytes, [0], page.rotation);
    const hasQuadCrop = !quadIsDefault(page.quad);
    const axisAlignedCrop = quadIsAxisAligned(page.quad);
    const needsRaster = page.filter !== 'original' || (hasQuadCrop && !axisAlignedCrop);

    if (!needsRaster && hasQuadCrop) {
      return cropPdfEdges(bytes, { ...cropFromQuad(page.quad), unit: 'percent' }, [0]);
    }
    if (!needsRaster) return bytes;

    let rasterPage = page;
    if (hasQuadCrop && axisAlignedCrop) {
      bytes = await cropPdfEdges(bytes, { ...cropFromQuad(page.quad), unit: 'percent' }, [0]);
      rasterPage = { ...page, quad: cloneQuad(DEFAULT_QUAD), crop: { top: 0, right: 0, bottom: 0, left: 0 } };
    }

    const rendered = await renderPages(bytes);
    const edited = await editedPreviewImage(rasterPage, rendered[0].bytes);
    const sourceSize = await getPdfPageSize(bytes, 0);
    const outputBox = outputPageBoxForRaster(sourceSize, pageSize, orientation, margin);
    return imageToPdfPage(edited, {
      width: outputBox.width,
      height: outputBox.height,
      margin: outputBox.margin,
      fit: 'contain',
    });
  };

  const exportPdf = () =>
    runner.run(async (onProgress) => {
      const selected = pages.filter((page) => page.included);
      if (!selected.length) throw new Error('Include at least one page before converting.');

      if (exportMode === 'separate' && sources.length > 1) {
        const saved: FileItem[] = [];
        for (let index = 0; index < sources.length; index++) {
          const source = sources[index];
          const sourcePages = selected.filter((page) => page.sourceId === source.id);
          if (!sourcePages.length) continue;
          const pieces: Uint8Array[] = [];
          for (const page of sourcePages) pieces.push(await makePagePdf(page));
          let output = pieces.length === 1 ? pieces[0] : await mergePdfs(pieces);
          if (quality !== 'original') output = await optimizePdf(output);
          saved.push(
            await useLibrary.getState().saveResult({
              bytes: output,
              name: withExt(`${baseName(source.file.name)} PDF`, 'pdf'),
              kind: 'pdf',
              ext: 'pdf',
              mime: 'application/pdf',
              pageCount: sourcePages.length,
              source: 'convert',
              conversionReport: buildReport(
                sourcePages.length,
                filterCount,
                cropCount,
                freeCropCount,
                source.report,
              ),
            }),
          );
          onProgress((index + 1) / sources.length);
        }
        if (!saved.length) throw new Error('No selected pages were exported.');
        return saved;
      }

      const pieces: Uint8Array[] = [];
      for (let index = 0; index < selected.length; index++) {
        pieces.push(await makePagePdf(selected[index]));
        onProgress(((index + 1) / selected.length) * 0.82);
      }
      let output = pieces.length === 1 ? pieces[0] : await mergePdfs(pieces);
      if (quality !== 'original') output = await optimizePdf(output);
      onProgress(0.94);
      const file = await useLibrary.getState().saveResult({
        bytes: output,
        name: withExt(fileName || 'Converted document', 'pdf'),
        kind: 'pdf',
        ext: 'pdf',
        mime: 'application/pdf',
        pageCount: selected.length,
        source: 'convert',
        conversionReport: buildReport(
          selected.length,
          filterCount,
          cropCount,
          freeCropCount,
          sources[0]?.report,
        ),
      });
      onProgress(1);
      return file;
    });

  return {
    profile,
    theme,
    desktop,
    runner,
    isPremium,
    profileTool,
    files,
    pages,
    setPages,
    selectedPage,
    selectedIndex,
    includedCount,
    filterCount,
    cropCount,
    freeCropCount,
    preparing,
    prepareError,
    prepareProgress,
    fileName,
    setFileName,
    pageSize,
    setPageSize,
    orientation,
    setOrientation,
    margin,
    setMargin,
    quality,
    setQuality,
    exportMode,
    setExportMode,
    csvDelimiter,
    setCsvDelimiter,
    textFontSize,
    setTextFontSize,
    cropTop,
    setCropTop,
    cropRight,
    setCropRight,
    cropBottom,
    setCropBottom,
    cropLeft,
    setCropLeft,
    fullscreen,
    setFullscreen,
    pickFiles,
    rebuildPreview,
    updatePage,
    selectPage,
    goToAdjacentPage,
    updatePageQuad,
    updateCurrentCrop,
    resetCrop,
    movePage,
    rotateCurrent,
    applyFilter,
    exportPdf,
  };
}

export type ConvertToPdfStudio = ReturnType<typeof useConvertToPdfStudio>;
