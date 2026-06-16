/**
 * Web file storage backed by IndexedDB (stores Blobs). Object URLs are created
 * lazily and cached so the viewer / <Image> can reference stored files. Mirrors
 * the native expo-file-system implementation in storage.ts.
 */
import { uid } from './uid';

export interface StoredRef {
  key: string;
  uri: string;
  size: number;
}

const DB_NAME = 'filemint';
const STORE = 'files';
let dbPromise: Promise<IDBDatabase> | null = null;
const urlCache = new Map<string, string>();

// Blobs need a correct MIME type or the browser renders PDFs/images as raw
// text inside an <iframe> (no Content-Type to trigger the PDF viewer).
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  svgz: 'image/svg+xml',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  json: 'application/json',
  xml: 'application/xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  log: 'text/plain',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  css: 'text/css',
  scss: 'text/x-scss',
  py: 'text/x-python',
  java: 'text/x-java-source',
  c: 'text/x-c',
  cpp: 'text/x-c++',
  h: 'text/x-c',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  go: 'text/x-go',
  rs: 'text/rust',
  php: 'application/x-httpd-php',
  rb: 'text/x-ruby',
  sh: 'application/x-sh',
  bat: 'application/x-msdos-program',
  ps1: 'text/plain',
  sql: 'application/sql',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbPut(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function init(): Promise<void> {
  return openDB().then(() => undefined);
}

export async function saveBytes(bytes: Uint8Array, ext: string, key?: string): Promise<StoredRef> {
  const k = key ?? `${uid()}.${ext}`;
  // A typed-array view is a valid BlobPart at runtime; the cast sidesteps the
  // ArrayBuffer vs SharedArrayBuffer generic friction in lib.dom. The MIME type
  // is essential so the <iframe>/<img> renders instead of showing raw bytes.
  const blob = new Blob([bytes as unknown as BlobPart], { type: mimeForExt(ext) });
  await idbPut(k, blob);
  // Overwriting an existing key (e.g. after editing) — revoke the stale URL.
  const stale = urlCache.get(k);
  if (stale) URL.revokeObjectURL(stale);
  const url = URL.createObjectURL(blob);
  urlCache.set(k, url);
  return { key: k, uri: url, size: blob.size };
}

export async function importUri(srcUri: string, ext: string, key?: string): Promise<StoredRef> {
  const res = await fetch(srcUri);
  const raw = await res.blob();
  const blob = raw.type ? raw : new Blob([raw], { type: mimeForExt(ext) });
  const k = key ?? `${uid()}.${ext}`;
  await idbPut(k, blob);
  const url = URL.createObjectURL(blob);
  urlCache.set(k, url);
  return { key: k, uri: url, size: blob.size };
}

export async function readBytes(key: string): Promise<Uint8Array> {
  const blob = await idbGet(key);
  if (!blob) throw new Error(`File not found: ${key}`);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function getUri(key: string): Promise<string> {
  const cached = urlCache.get(key);
  if (cached) return cached;
  const blob = await idbGet(key);
  if (!blob) throw new Error(`File not found: ${key}`);
  // Re-tag blobs that were stored before MIME types were applied (key is
  // "<id>.<ext>"), so the browser renders them instead of showing raw bytes.
  const ext = key.includes('.') ? key.slice(key.lastIndexOf('.') + 1) : '';
  const typed = blob.type ? blob : new Blob([blob], { type: mimeForExt(ext) });
  const url = URL.createObjectURL(typed);
  urlCache.set(key, url);
  return url;
}

export async function getDataUrl(key: string, mime: string): Promise<string> {
  const blob = await idbGet(key);
  if (!blob) throw new Error(`File not found: ${key}`);
  const typed = blob.type ? blob : blob.slice(0, blob.size, mime);
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(typed);
  });
}

export async function remove(key: string): Promise<void> {
  await idbDelete(key);
  const url = urlCache.get(key);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(key);
  }
}
