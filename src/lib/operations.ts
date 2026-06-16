/**
 * Behavior registry for the generic /tool/[id] screen. Each operation declares
 * how to gather input (file picker config + option fields) and how to run.
 * Client-side ops use pdf-lib / pdf.js; backend ops upload to the conversion
 * server and declare which capability they need so the UI can gate honestly.
 */
import JSZip from 'jszip';

import { type ServerCapabilities, checkServer, convertFile, getServerBaseUrl } from '@/lib/api';
import { baseName, withExt } from '@/lib/format';
import {
  addPageNumbers,
  addWatermark,
  cropPdf,
  flattenForms,
  csvRowsToPdf,
  textToPdf,
  type NumberPosition,
} from '@/lib/pdf';
import { extractPdfText, renderPdfToImages } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import { decodeUtf8, encodeUtf8, parseCsvRows } from '@/lib/text';
import { useLibrary } from '@/store/useLibrary';
import { useSettings } from '@/store/useSettings';
import type { RunResult } from '@/hooks/use-runner';
import type { FileItem, FileKind } from '@/types';

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

export type FieldValues = Record<string, string | boolean>;

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

const OFFICE_KINDS: FileKind[] = ['word', 'excel', 'ppt'];

const num = (v: FieldValues, k: string, d: number) => {
  const x = v[k];
  const n = typeof x === 'string' ? parseFloat(x) : NaN;
  return Number.isFinite(n) ? n : d;
};
const str = (v: FieldValues, k: string, d = '') => (typeof v[k] === 'string' ? (v[k] as string) : d);
const bool = (v: FieldValues, k: string) => v[k] === true || v[k] === 'true';

const save = (input: Parameters<ReturnType<typeof useLibrary.getState>['saveResult']>[0]) =>
  useLibrary.getState().saveResult(input);

const WM_COLORS: Record<string, { r: number; g: number; b: number }> = {
  gray: { r: 0.5, g: 0.5, b: 0.5 },
  red: { r: 0.86, g: 0.15, b: 0.15 },
  blue: { r: 0.15, g: 0.35, b: 0.85 },
  green: { r: 0.1, g: 0.6, b: 0.35 },
};

async function ensureServerCapability(capability: keyof ServerCapabilities, label: string) {
  const status = await checkServer();
  if (!status.online) {
    throw new Error(`Can't reach the conversion server at ${getServerBaseUrl()}. Start it with "npm run server", then set the same address in Settings.`);
  }
  if (!status.capabilities[capability]) {
    throw new Error(
      `${label} is not available on the server at ${getServerBaseUrl()}. Stop the old server and restart it with "npm run server". If it still shows unavailable, run "pip install -r server/requirements.txt" from the FileMint project folder.`,
    );
  }
}

async function backendConvert(
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

function officeToPdf(libraryKinds: FileKind[], deviceTypes: string[]): ToolOperation {
  return {
    mode: 'process',
    libraryKinds,
    deviceTypes,
    pickTitle: 'Select a document',
    serverCapability: 'libreoffice',
    run: ({ file, onProgress }) => backendConvert(file!, 'convert', { target: 'pdf' }, 'pdf', onProgress),
  };
}

function pdfToFormat(targetExt: string, capability: keyof ServerCapabilities = 'libreoffice'): ToolOperation {
  return {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: capability,
    run: ({ file, onProgress }) => backendConvert(file!, 'convert', { target: targetExt }, targetExt, onProgress),
  };
}

function pdfToImages(format: 'png' | 'jpg'): ToolOperation {
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

async function backendRenderPdfImages(file: FileItem, format: 'png' | 'jpg', onProgress: (p: number) => void) {
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

async function backendPdfText(file: FileItem, onProgress: (p: number) => void): Promise<RunResult> {
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

const OCR_LANGUAGE_FIELD: ToolField = {
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

function pdfExportTo(targetExt: 'xlsx' | 'pptx' | 'html'): ToolOperation {
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
        : { key: 'textLayer', label: targetExt === 'pptx' ? 'Add editable text layer' : 'Add selectable text layer', type: 'switch', default: true },
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

const OPERATIONS: Record<string, ToolOperation> = {
  // --- view / open
  'import-pdf': { mode: 'open', libraryKinds: ['pdf'], deviceTypes: 'application/pdf', pickTitle: 'Import a PDF' },
  'open-pdf': { mode: 'open', libraryKinds: ['pdf'], deviceTypes: 'application/pdf', pickTitle: 'Open a PDF' },
  'open-document': {
    mode: 'open',
    libraryKinds: ['pdf', 'image', 'word', 'excel', 'ppt', 'text', 'csv', 'other'],
    deviceTypes: '*/*',
    pickTitle: 'Open a document',
    pickSubtitle: 'Read PDFs, Word, PowerPoint, Excel, CSV, HTML, text, and code files.',
    pickIcon: 'file-eye-outline',
  },

  // --- compose
  'txt-to-pdf': {
    mode: 'compose',
    pickIcon: 'note-text-outline',
    fields: [
      { key: 'name', label: 'File name', type: 'text', default: 'Note' },
      { key: 'content', label: 'Text', type: 'multiline', placeholder: 'Type or paste your text…' },
    ],
    run: async ({ values, onProgress }) => {
      const content = str(values, 'content');
      if (!content.trim()) throw new Error('Enter some text first.');
      onProgress(0.4);
      const pdf = await textToPdf(content, { title: str(values, 'name', 'Note') });
      return save({ bytes: pdf, name: withExt(str(values, 'name', 'Note'), 'pdf'), ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'created' });
    },
  },

  'csv-to-pdf': {
    mode: 'process',
    libraryKinds: ['csv', 'text'],
    deviceTypes: ['text/csv', 'text/comma-separated-values', 'text/plain'],
    pickTitle: 'Select a CSV file',
    pickIcon: 'file-delimited-outline',
    run: async ({ file, onProgress }) => {
      const bytes = await storage.readBytes(file!.storageKey);
      onProgress(0.4);
      const rows = parseCsvRows(decodeUtf8(bytes));
      if (!rows.length) throw new Error('No CSV rows were found.');
      const pdf = await csvRowsToPdf(rows, baseName(file!.name));
      return save({ bytes: pdf, name: `${baseName(file!.name)}.pdf`, ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'convert' });
    },
  },

  // --- edit (client)
  'add-watermark': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    fields: [
      { key: 'text', label: 'Watermark text', type: 'text', default: 'CONFIDENTIAL' },
      { key: 'color', label: 'Color', type: 'select', default: 'gray', options: [
        { label: 'Gray', value: 'gray' },
        { label: 'Red', value: 'red' },
        { label: 'Blue', value: 'blue' },
        { label: 'Green', value: 'green' },
      ] },
      { key: 'opacity', label: 'Opacity', type: 'select', default: '0.2', options: [
        { label: 'Light', value: '0.12' },
        { label: 'Medium', value: '0.2' },
        { label: 'Strong', value: '0.38' },
      ] },
      { key: 'rotation', label: 'Angle', type: 'select', default: '45', options: [
        { label: 'Diagonal', value: '45' },
        { label: 'Horizontal', value: '0' },
      ] },
      { key: 'fontSize', label: 'Size', type: 'number', default: '54' },
    ],
    run: async ({ file, values, onProgress }) => {
      const bytes = await storage.readBytes(file!.storageKey);
      onProgress(0.4);
      const out = await addWatermark(bytes, {
        text: str(values, 'text', 'CONFIDENTIAL') || 'WATERMARK',
        color: WM_COLORS[str(values, 'color', 'gray')] ?? WM_COLORS.gray,
        opacity: num(values, 'opacity', 0.2),
        rotation: num(values, 'rotation', 45),
        fontSize: num(values, 'fontSize', 54),
      });
      return save({ bytes: out, name: `${baseName(file!.name)} watermarked.pdf`, ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'created' });
    },
  },

  'add-page-numbers': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    fields: [
      { key: 'position', label: 'Position', type: 'select', default: 'bottom-center', options: [
        { label: 'Bottom center', value: 'bottom-center' },
        { label: 'Bottom right', value: 'bottom-right' },
        { label: 'Top right', value: 'top-right' },
      ] },
      { key: 'format', label: 'Style', type: 'select', default: '{n}', options: [
        { label: '1', value: '{n}' },
        { label: '1 / N', value: '{n} / {total}' },
        { label: 'Page 1', value: 'Page {n}' },
      ] },
      { key: 'startAt', label: 'Start at', type: 'number', default: '1' },
      { key: 'fontSize', label: 'Size', type: 'number', default: '12' },
    ],
    run: async ({ file, values, onProgress }) => {
      const bytes = await storage.readBytes(file!.storageKey);
      onProgress(0.4);
      const out = await addPageNumbers(bytes, {
        position: str(values, 'position', 'bottom-center') as NumberPosition,
        format: str(values, 'format', '{n}'),
        startAt: Math.round(num(values, 'startAt', 1)),
        fontSize: num(values, 'fontSize', 12),
        margin: 28,
      });
      return save({ bytes: out, name: `${baseName(file!.name)} numbered.pdf`, ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'created' });
    },
  },

  flatten: {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    pickSubtitle: 'Bake form fields and annotations into the page content.',
    run: async ({ file, onProgress }) => {
      const bytes = await storage.readBytes(file!.storageKey);
      onProgress(0.4);
      const out = await flattenForms(bytes);
      return save({ bytes: out, name: `${baseName(file!.name)} flattened.pdf`, ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'created' });
    },
  },

  'crop-pdf': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    fields: [{ key: 'margin', label: 'Trim from each edge (pt)', type: 'number', default: '24', hint: '72 points = 1 inch' }],
    run: async ({ file, values, onProgress }) => {
      const bytes = await storage.readBytes(file!.storageKey);
      onProgress(0.4);
      const out = await cropPdf(bytes, num(values, 'margin', 24));
      return save({ bytes: out, name: `${baseName(file!.name)} cropped.pdf`, ext: 'pdf', kind: 'pdf', mime: 'application/pdf', source: 'created' });
    },
  },

  'pdf-to-text': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    run: async ({ file, onProgress }) => {
      try {
        const bytes = await storage.readBytes(file!.storageKey);
        const text = await extractPdfText(bytes, (p) => onProgress(p * 0.8));
        if (text.trim()) {
          return save({ bytes: encodeUtf8(text), name: `${baseName(file!.name)}.txt`, ext: 'txt', kind: 'text', mime: 'text/plain', source: 'convert' });
        }
      } catch {
        // Fall through to the server fallback below.
      }
      return backendPdfText(file!, onProgress);
    },
  },

  'pdf-to-jpg': pdfToImages('jpg'),
  'pdf-to-png': pdfToImages('png'),

  // --- backend conversions
  'docx-to-pdf': officeToPdf(['word'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword']),
  'pptx-to-pdf': officeToPdf(['ppt'], ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint']),
  'xlsx-to-pdf': officeToPdf(['excel'], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel']),
  'pdf-to-pptx': pdfExportTo('pptx'),
  'pdf-to-xlsx': pdfExportTo('xlsx'),
  'pdf-to-html': pdfExportTo('html'),
  'pdf-to-docx': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'pdf2docx',
    fields: [
      {
        key: 'mode',
        label: 'Conversion mode',
        type: 'select',
        default: 'hybrid',
        options: [
          { label: 'Hybrid editable', value: 'hybrid' },
          { label: 'High accuracy editable', value: 'high-accuracy' },
          { label: 'Exact layout', value: 'exact' },
          { label: 'OCR editable', value: 'ocr' },
          { label: 'Image only fallback', value: 'image' },
        ],
        hint: 'Hybrid keeps text and tables editable while placing signatures, seals, logos and photos as positioned images. Image only is non-editable fallback.',
      },
      {
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
        hint: 'Auto uses server/project OCR packs when available. Choose a script mix for scanned PDFs.',
      },
      { key: 'autoDetectLanguage', label: 'Auto-detect OCR language', type: 'switch', default: true },
      { key: 'preserveLayout', label: 'Preserve exact layout', type: 'switch', default: true },
      { key: 'tableDetection', label: 'Detect editable tables', type: 'switch', default: true },
      { key: 'keepVisualObjects', label: 'Keep images, stamps and signatures', type: 'switch', default: true },
      {
        key: 'visualObjectFormat',
        label: 'Non-editable object format',
        type: 'select',
        default: 'png',
        options: [
          { label: 'PNG', value: 'png' },
          { label: 'JPG', value: 'jpg' },
        ],
      },
      {
        key: 'docxQuality',
        label: 'DOCX quality',
        type: 'select',
        default: 'high',
        options: [
          { label: 'Original', value: 'original' },
          { label: 'High', value: 'high' },
          { label: 'Medium', value: 'medium' },
          { label: 'Low', value: 'low' },
        ],
      },
    ],
    run: ({ file, values, onProgress }) =>
      backendConvert(
        file!,
        'convert',
        {
          target: 'docx',
          mode: str(values, 'mode', 'hybrid'),
          language: str(values, 'language', 'auto') || useSettings.getState().ocrLanguage,
          autoDetectLanguage: bool(values, 'autoDetectLanguage'),
          preserveLayout: bool(values, 'preserveLayout'),
          tableDetection: bool(values, 'tableDetection'),
          keepVisualObjects: bool(values, 'keepVisualObjects'),
          visualObjectFormat: str(values, 'visualObjectFormat', 'png'),
          docxQuality: str(values, 'docxQuality', 'high'),
        },
        'docx',
        onProgress,
      ),
  },
  'pdf-to-searchable': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'ocr',
    fields: [
      OCR_LANGUAGE_FIELD,
      {
        key: 'ocrMode',
        label: 'OCR mode',
        type: 'select',
        default: 'auto',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: 'Force OCR', value: 'true' },
          { label: 'Keep existing text', value: 'false' },
        ],
        hint: 'Auto OCRs scanned/image-backed pages and preserves normal searchable pages.',
      },
      { key: 'deskew', label: 'Straighten scanned pages', type: 'switch', default: true },
      { key: 'rotatePages', label: 'Auto-rotate pages', type: 'switch', default: true },
    ],
    run: ({ file, values, onProgress }) =>
      backendConvert(
        file!,
        'ocr',
        {
          language: str(values, 'language', 'auto') || useSettings.getState().ocrLanguage,
          forceOcr: str(values, 'ocrMode', 'auto'),
          deskew: values.deskew === undefined ? true : bool(values, 'deskew'),
          rotatePages: values.rotatePages === undefined ? true : bool(values, 'rotatePages'),
        },
        'pdf',
        onProgress,
        'searchable',
      ),
  },

  // --- security (backend)
  'lock-pdf': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'qpdf',
    fields: [{ key: 'password', label: 'Password', type: 'password', placeholder: 'Choose a password' }],
    run: ({ file, values, onProgress }) => {
      const password = str(values, 'password');
      if (!password) throw new Error('Enter a password.');
      return backendConvert(file!, 'secure/lock', { password }, 'pdf', onProgress, 'locked');
    },
  },
  'unlock-pdf': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'qpdf',
    fields: [{ key: 'password', label: 'Current password', type: 'password' }],
    run: ({ file, values, onProgress }) => {
      const password = str(values, 'password');
      if (!password) throw new Error('Enter the current password.');
      return backendConvert(file!, 'secure/unlock', { password }, 'pdf', onProgress, 'unlocked');
    },
  },
  'pdf-permissions': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'qpdf',
    fields: [
      { key: 'ownerPassword', label: 'Owner password', type: 'password', placeholder: 'Protects the restrictions' },
      { key: 'allowPrint', label: 'Allow printing', type: 'switch', default: true },
      { key: 'allowCopy', label: 'Allow copying text', type: 'switch', default: false },
    ],
    run: ({ file, values, onProgress }) => {
      const ownerPassword = str(values, 'ownerPassword');
      if (!ownerPassword) throw new Error('Enter an owner password.');
      return backendConvert(
        file!,
        'secure/permissions',
        { ownerPassword, allowPrint: bool(values, 'allowPrint'), allowCopy: bool(values, 'allowCopy') },
        'pdf',
        onProgress,
        'protected',
      );
    },
  },
  'repair-pdf': {
    mode: 'process',
    libraryKinds: ['pdf'],
    deviceTypes: 'application/pdf',
    serverCapability: 'pdfRepair',
    pickSubtitle: 'Rebuild a damaged or corrupted PDF on the server.',
    run: ({ file, onProgress }) => backendConvert(file!, 'repair', {}, 'pdf', onProgress, 'repaired'),
  },
};

export function getOperation(id: string): ToolOperation | null {
  return OPERATIONS[id] ?? null;
}
