/**
 * Behavior registry for the generic /tool/[id] screen. Each operation declares
 * how to gather input (file picker config + option fields) and how to run.
 * Client-side ops use pdf-lib / pdf.js; backend ops upload to the conversion
 * server and declare which capability they need so the UI can gate honestly.
 */
import JSZip from 'jszip';

import { type ServerCapabilities, checkServer, convertFile, getServerBaseUrl } from '@/lib/api';
import { baseName, withExt } from '@/lib/format';
import { renderPdfToImages } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import type { RunResult } from '@/hooks/use-runner';
import type { FileItem, FileKind } from '@/types';
import { booleanValue as bool, stringValue as str, type FieldValues } from './operations.values';

export type FieldType = 'text' | 'multiline' | 'number' | 'password' | 'select' | 'switch';

export interface ToolField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  default?: string | boolean;
  options?: { label: string; value: string }[];
  hint?: string;
}

export interface OperationContext {
  file: FileItem | null;
  values: FieldValues;
  onProgress: (p: number) => void;
}

export interface ToolOperation {
  mode: 'process' | 'open' | 'compose';
  libraryKinds?: FileKind[];
  deviceTypes?: string | string[];
  pickTitle?: string;
  pickSubtitle?: string;
  pickIcon?: string;
  fields?: ToolField[];
  serverCapability?: keyof ServerCapabilities;
  run?: (ctx: OperationContext) => Promise<RunResult>;
}

export const save = (input: Parameters<ReturnType<typeof useLibrary.getState>['saveResult']>[0]) =>
  useLibrary.getState().saveResult(input);

export const WM_COLORS: Record<string, { r: number; g: number; b: number }> = {
  gray: { r: 0.5, g: 0.5, b: 0.5 },
  red: { r: 0.86, g: 0.15, b: 0.15 },
  blue: { r: 0.15, g: 0.35, b: 0.85 },
  green: { r: 0.1, g: 0.6, b: 0.35 },
};

export async function ensureServerCapability(capability: keyof ServerCapabilities, label: string) {
  const status = await checkServer();
  if (!status.online) {
    throw new Error(
      `Can't reach the conversion server at ${getServerBaseUrl()}. Start it with "npm run server", then set the same address in Settings.`,
    );
  }
  if (!status.capabilities[capability]) {
    throw new Error(
      `${label} is not available on the server at ${getServerBaseUrl()}. Stop the old server and restart it with "npm run server". If it still shows unavailable, run "pip install -r server/requirements.lock.txt" from the FileMint project folder.`,
    );
  }
}

export async function backendConvert(
  file: FileItem,
  endpoint: string,
  fields: Record<string, string | number | boolean>,
  targetExt: string,
  onProgress: (p: number) => void,
  nameSuffix?: string,
): Promise<RunResult> {
  onProgress(0.15);
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({ endpoint, fileUri: uri, fileName: file.name, mime: file.mime, fields });
  onProgress(0.92);
  const fallback = `${baseName(file.name)}${nameSuffix ? ` ${nameSuffix}` : ''}.${targetExt}`;
  const name = res.filename && res.filename !== 'result' ? res.filename : fallback;
  return save({
    bytes: res.bytes,
    name: withExt(name, targetExt),
    ext: targetExt,
    mime: res.mime,
    source: 'convert',
    conversionReport: res.report,
  });
}

export function officeToPdf(libraryKinds: FileKind[], deviceTypes: string[]): ToolOperation {
  return {
    mode: 'process',
    libraryKinds,
    deviceTypes,
    pickTitle: 'Select a document',
    serverCapability: 'libreoffice',
    run: ({ file, onProgress }) => backendConvert(file!, 'convert', { target: 'pdf' }, 'pdf', onProgress),
  };
}

export function pdfToImages(format: 'png' | 'jpg'): ToolOperation {
  return {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    run: async ({ file, onProgress }) => {
      let images: RenderedServerImage[];
      let report = undefined;
      try {
        const bytes = await storage.readBytes(file!.storageKey);
        images = await renderPdfToImages(bytes, format, 2, (p) => onProgress(p * 0.8));
      } catch {
        const fallback = await backendRenderPdfImages(file!, format, onProgress);
        images = fallback.images;
        report = fallback.report;
      }
      const base = baseName(file!.name);
      const saved: FileItem[] = [];
      for (let i = 0; i < images.length; i++) {
        saved.push(
          await save({
            bytes: images[i].bytes,
            name: `${base} p${i + 1}.${images[i].ext}`,
            ext: images[i].ext,
            kind: 'image',
            mime: images[i].ext === 'png' ? 'image/png' : 'image/jpeg',
            source: 'convert',
            conversionReport: report,
          }),
        );
        onProgress(0.8 + ((i + 1) / images.length) * 0.2);
      }
      if (saved.length === 0) throw new Error('No pages were rendered.');
      return saved;
    },
  };
}

interface RenderedServerImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg';
}

async function backendRenderPdfImages(
  file: FileItem,
  format: 'png' | 'jpg',
  onProgress: (p: number) => void,
) {
  await ensureServerCapability('pdfUtility', 'PDF page rendering');
  onProgress(0.12);
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { format, dpi: 180 },
  });
  onProgress(0.7);
  const zip = await JSZip.loadAsync(res.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(`.${format}`))
    .sort((a, b) => a.name.localeCompare(b.name));
  const images: RenderedServerImage[] = [];
  for (const entry of entries) {
    images.push({ bytes: await entry.async('uint8array'), ext: format });
  }
  if (!images.length) throw new Error('The server did not return any rendered pages.');
  return { images, report: res.report };
}

export async function backendPdfText(file: FileItem, onProgress: (p: number) => void): Promise<RunResult> {
  await ensureServerCapability('pdfUtility', 'PDF text extraction');
  onProgress(0.12);
  const uri = await storage.getUri(file.storageKey);
  const res = await convertFile({
    endpoint: 'pdf/text',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { language: useSettings.getState().ocrLanguage || 'auto' },
  });
  onProgress(0.9);
  return save({
    bytes: res.bytes,
    name: `${baseName(file.name)}.txt`,
    ext: 'txt',
    kind: 'text',
    mime: 'text/plain',
    source: 'convert',
    conversionReport: res.report,
  });
}

export const OCR_LANGUAGE_FIELD: ToolField = {
  key: 'language',
  label: 'OCR language',
  type: 'select',
  default: 'auto',
  options: [
    { label: 'Auto / mixed', value: 'auto' },
    { label: 'English', value: 'eng' },
    { label: 'Russian', value: 'rus' },
    { label: 'Tajik', value: 'tgk' },
    { label: 'Persian', value: 'fas' },
    { label: 'Arabic', value: 'ara' },
    { label: 'Chinese', value: 'chi_sim' },
    { label: 'English + Russian', value: 'eng+rus' },
    { label: 'English + Russian + Tajik', value: 'eng+rus+tgk' },
  ],
  hint: 'Used only when a scanned PDF needs OCR.',
};

export function pdfExportTo(targetExt: 'xlsx' | 'pptx' | 'html'): ToolOperation {
  const isXlsx = targetExt === 'xlsx';
  return {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'pdfExport',
    fields: [
      OCR_LANGUAGE_FIELD,
      isXlsx
        ? { key: 'tableDetection', label: 'Detect editable tables', type: 'switch', default: true }
        : {
            key: 'textLayer',
            label: targetExt === 'pptx' ? 'Add editable text layer' : 'Add selectable text layer',
            type: 'switch',
            default: true,
          },
    ],
    run: ({ file, values, onProgress }) =>
      backendConvert(
        file!,
        'convert',
        {
          target: targetExt,
          language: str(values, 'language', 'auto') || useSettings.getState().ocrLanguage,
          tableDetection: bool(values, 'tableDetection'),
          textLayer: values.textLayer === undefined ? true : bool(values, 'textLayer'),
        },
        targetExt,
        onProgress,
      ),
  };
}
