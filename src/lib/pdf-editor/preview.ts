import JSZip from 'jszip';

import { convertFile } from '@/lib/api';
import { dataUrl } from '@/lib/base64';
import type { RenderedImage } from '@/lib/pdf-render';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

export function imageToUri(image: RenderedImage) {
  return dataUrl(image.ext === 'jpg' ? 'image/jpeg' : 'image/png', image.bytes);
}

export function fileExtensionFromName(name: string, fallback = 'png') {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match?.[1]?.toLowerCase() ?? fallback;
}

export function mimeFromImageName(name: string, fallback?: string) {
  const ext = fileExtensionFromName(name);
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return fallback || 'image/png';
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function renderWithServer(file: FileItem): Promise<RenderedImage[]> {
  const uri = await storage.getUri(file.storageKey);
  const response = await convertFile({
    endpoint: 'pdf/render',
    fileUri: uri,
    fileName: file.name,
    mime: file.mime,
    fields: { format: 'jpg', dpi: 132 },
  });
  const zip = await JSZip.loadAsync(response.bytes);
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir && /\.(jpe?g)$/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const pages: RenderedImage[] = [];
  for (const entry of entries) pages.push({ bytes: await entry.async('uint8array'), ext: 'jpg' });
  if (!pages.length) throw new Error('No page previews were returned.');
  return pages;
}
