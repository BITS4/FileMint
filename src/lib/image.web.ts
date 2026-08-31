/**
 * Web: prepare a stored image for embedding in a PDF. JPEG/PNG embed directly.
 * Browser-decodable formats are rasterized locally; formats the browser cannot
 * decode, such as many HEIC/TIFF files, fall back to the conversion server.
 */
import { convertFile } from './api';
import { imageMime, sniffImageType, type ImageSig } from './image-sniff';
import { getUri, readBytes } from './storage';

export interface PreparedImage {
  bytes: Uint8Array;
  ext: 'png' | 'jpg';
}

export interface ImageEditOptions {
  rotate?: 0 | 90 | 180 | 270;
  filter?: 'none' | 'grayscale' | 'contrast' | 'bw';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode'));
    img.src = src;
  });
}

function applyPixelFilter(canvas: HTMLCanvasElement, filter: ImageEditOptions['filter']) {
  if (!filter || filter === 'none') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    if (filter === 'bw') {
      const v = gray > 150 ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
    } else if (filter === 'contrast') {
      const factor = 1.35;
      data[i] = Math.max(0, Math.min(255, (data[i] - 128) * factor + 128));
      data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - 128) * factor + 128));
      data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - 128) * factor + 128));
    } else {
      data[i] = gray;
      data[i + 1] = gray;
      data[i + 2] = gray;
    }
  }
  ctx.putImageData(image, 0, 0);
}

async function rasterizeInBrowser(
  bytes: Uint8Array,
  mime: string,
  edits: ImageEditOptions = {},
): Promise<PreparedImage> {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mime }));
  try {
    const img = await loadImage(url);
    const rotate = edits.rotate ?? 0;
    const sideways = rotate === 90 || rotate === 270;
    const canvas = document.createElement('canvas');
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    canvas.width = sideways ? ih : iw;
    canvas.height = sideways ? iw : ih;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available in this browser.');
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.drawImage(img, -iw / 2, -ih / 2);
    applyPixelFilter(canvas, edits.filter);
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'),
    );
    return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function normalizeOnServer(
  storageKey: string,
  ext: string,
  sig: ImageSig,
  edits: ImageEditOptions = {},
): Promise<PreparedImage> {
  const fileUri = await getUri(storageKey);
  try {
    const res = await convertFile({
      endpoint: 'image/normalize',
      fileUri,
      fileName: `image.${ext || sig || 'bin'}`,
      mime: imageMime(sig, ext),
      fields: {
        rotate: edits.rotate ?? 0,
        filter: edits.filter ?? 'none',
      },
    });
    return { bytes: res.bytes, ext: 'png' };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'The conversion server could not normalize it.';
    throw new Error(`Could not decode this image locally or on the server (${sig}). ${detail}`);
  }
}

function hasEdits(edits: ImageEditOptions = {}) {
  return (edits.rotate ?? 0) !== 0 || (!!edits.filter && edits.filter !== 'none');
}

export async function prepareImageForPdf(
  storageKey: string,
  ext: string,
  edits: ImageEditOptions = {},
): Promise<PreparedImage> {
  const bytes = await readBytes(storageKey);
  const sig = sniffImageType(bytes);
  if (!hasEdits(edits) && sig === 'jpg') return { bytes, ext: 'jpg' };
  if (!hasEdits(edits) && sig === 'png') return { bytes, ext: 'png' };

  try {
    return await rasterizeInBrowser(bytes, imageMime(sig, ext), edits);
  } catch {
    return normalizeOnServer(storageKey, ext, sig, edits);
  }
}
