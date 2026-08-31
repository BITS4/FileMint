/**
 * Native: prepare a stored image for embedding in a PDF. Detection is by
 * content (magic bytes). pdf-lib embeds JPEG/PNG directly; other formats are
 * normalized through the conversion server when available.
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
    throw new Error(`Unsupported image format (${sig}). ${detail}`);
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
  return normalizeOnServer(storageKey, ext, sig, edits);
}
