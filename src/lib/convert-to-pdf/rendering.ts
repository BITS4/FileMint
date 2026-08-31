import JSZip from 'jszip';
import { Platform } from 'react-native';

import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import { baseName } from '@/lib/format';
import { prepareImageForPdf } from '@/lib/image';
import { csvRowsToPdf, imagesToPdf, textToPdf } from '@/lib/pdf';
import { renderPdfToImages, type RenderedImage } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import { decodeUtf8 } from '@/lib/text';
import type { ConversionReport, FileItem } from '@/types';
import {
  assertPdfBytes,
  clamp01,
  cloneBytes,
  mapFilter,
  marginPoints,
  orientationForPdf,
  pageSizeForPdf,
  parseDelimitedRows,
  parseNumber,
  type FilterId,
  type MarginKey,
  type OrientationChoice,
  type PageSizeChoice,
  type StudioPage,
} from './model';

async function renderWithServer(
  bytes: Uint8Array,
  onProgress?: (p: number) => void,
): Promise<RenderedImage[]> {
  const temp = await storage.saveBytes(bytes, 'pdf');
  const uri = await storage.getUri(temp.key);
  const res = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: 'preview.pdf',
    mime: 'application/pdf',
    fields: { format: 'png', dpi: 160 },
  });
  onProgress?.(0.65);
  const zip = await JSZip.loadAsync(res.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith('.png'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const out: RenderedImage[] = [];
  for (const entry of entries) out.push({ bytes: await entry.async('uint8array'), ext: 'png' });
  if (!out.length) throw new Error('The server did not return preview pages.');
  return out;
}

export async function renderPages(
  bytes: Uint8Array,
  onProgress?: (p: number) => void,
): Promise<RenderedImage[]> {
  try {
    return await renderPdfToImages(cloneBytes(bytes), 'png', 1.55, onProgress);
  } catch {
    return renderWithServer(cloneBytes(bytes), onProgress);
  }
}

function loadBrowserImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode preview image for crop.'));
    img.src = src;
  });
}

function applyCanvasFilter(ctx: CanvasRenderingContext2D, width: number, height: number, filter: FilterId) {
  if (filter === 'original') return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const contrast =
    filter === 'high-contrast' || filter === 'whiteboard' || filter === 'bw'
      ? 1.9
      : filter === 'enhance-2' || filter === 'magic-color' || filter === 'clean-bg'
        ? 1.42
        : filter === 'photo'
          ? 1.08
          : 1.25;
  const brightness =
    filter === 'brighter' || filter === 'light-text'
      ? 22
      : filter === 'darker'
        ? -22
        : filter === 'clean-bg' || filter === 'remove-shadows' || filter === 'whiteboard'
          ? 16
          : 0;
  const saturation = filter === 'photo' || filter === 'magic-color' || filter === 'auto-color' ? 1.22 : 1;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    const gray = r * 0.299 + g * 0.587 + b * 0.114;

    if (filter === 'grayscale' || filter === 'light-text') {
      r = gray;
      g = gray;
      b = gray;
    } else if (filter === 'bw' || filter === 'whiteboard') {
      const v = gray > (filter === 'whiteboard' ? 170 : 150) ? 255 : 0;
      r = v;
      g = v;
      b = v;
    } else {
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
    }

    r = (r - 128) * contrast + 128 + brightness;
    g = (g - 128) * contrast + 128 + brightness;
    b = (b - 128) * contrast + 128 + brightness;

    if (filter === 'clean-bg' || filter === 'remove-shadows' || filter === 'whiteboard') {
      const light = (r + g + b) / 3;
      if (light > 205) {
        r = 255;
        g = 255;
        b = 255;
      }
    }

    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(image, 0, 0);
}

export async function editedPreviewImage(
  page: StudioPage,
  previewBytes: Uint8Array,
): Promise<{ bytes: Uint8Array; ext: 'png' }> {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || typeof window === 'undefined') {
    const temp = await storage.saveBytes(previewBytes, 'png');
    const prepared = await prepareImageForPdf(temp.key, 'png', { filter: mapFilter(page.filter) });
    return { bytes: prepared.bytes, ext: 'png' };
  }

  const image = await loadBrowserImage(dataUrl('image/png', previewBytes));
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const quad = page.quad;
  const points = [quad.tl, quad.tr, quad.br, quad.bl].map((point) => ({
    x: clamp01(point.x) * sourceWidth,
    y: clamp01(point.y) * sourceHeight,
  }));
  const minX = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))));
  const maxX = Math.min(sourceWidth, Math.ceil(Math.max(...points.map((point) => point.x))));
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(sourceHeight, Math.ceil(Math.max(...points.map((point) => point.y))));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable for crop preview.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = point.x - minX;
    const y = point.y - minY;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, -minX, -minY);
  ctx.restore();
  applyCanvasFilter(ctx, width, height, page.filter);

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode cropped page.'))),
      'image/png',
      0.96,
    ),
  );
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
}

export async function sourcePdfFromFile(
  file: FileItem,
  settings: {
    pageSize: PageSizeChoice;
    orientation: OrientationChoice;
    margin: MarginKey;
    csvDelimiter: string;
    textFontSize: string;
  },
): Promise<{ bytes: Uint8Array; report?: ConversionReport }> {
  if (file.kind === 'word' || file.kind === 'ppt' || file.kind === 'excel') {
    const uri = await storage.getUri(file.storageKey);
    const res = await convertFile({
      endpoint: 'convert',
      fileUri: uri,
      fileName: file.name,
      mime: file.mime,
      fields: { target: 'pdf' },
    });
    assertPdfBytes(res.bytes, file.name);
    return { bytes: res.bytes, report: res.report };
  }

  if (file.kind === 'image') {
    const image = await prepareImageForPdf(file.storageKey, file.ext, {});
    const pdf = await imagesToPdf([image], {
      pageSize: pageSizeForPdf(settings.pageSize),
      orientation: orientationForPdf(settings.orientation),
      margin: marginPoints(settings.margin),
      fit: 'contain',
    });
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  const raw = decodeUtf8(await storage.readBytes(file.storageKey));
  if (file.kind === 'csv' || file.ext === 'csv') {
    const rows = parseDelimitedRows(raw, settings.csvDelimiter);
    if (!rows.length) throw new Error(`${file.name} does not contain readable CSV rows.`);
    const pdf = await csvRowsToPdf(rows, baseName(file.name));
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  if (file.kind === 'text') {
    const pdf = await textToPdf(raw, {
      title: baseName(file.name),
      fontSize: Math.max(7, Math.min(24, parseNumber(settings.textFontSize, 11))),
      pageSize: settings.pageSize === 'legal' ? 'legal' : settings.pageSize === 'letter' ? 'letter' : 'a4',
    });
    assertPdfBytes(pdf, file.name);
    return { bytes: pdf };
  }

  throw new Error(`${file.name} is not supported for PDF conversion.`);
}
