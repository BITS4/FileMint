/**
 * Native file storage (iOS / Android) backed by expo-file-system. Files live
 * under <documentDirectory>/filemint/. A matching web implementation lives in
 * storage.web.ts (Metro picks the right one per platform; tsc resolves this
 * file for types, so both must export identical signatures).
 */
import * as FileSystem from 'expo-file-system/legacy';

import { base64ToBytes, bytesToBase64 } from './base64';
import { uid } from './uid';

export interface StoredRef {
  key: string;
  uri: string;
  size: number;
}

const DIR = `${FileSystem.documentDirectory ?? ''}filemint/`;
let ready: Promise<void> | null = null;

export function init(): Promise<void> {
  if (!ready) {
    ready = FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
  }
  return ready;
}

function pathFor(key: string): string {
  return DIR + key;
}

export async function saveBytes(bytes: Uint8Array, ext: string, key?: string): Promise<StoredRef> {
  await init();
  const k = key ?? `${uid()}.${ext}`;
  const uri = pathFor(k);
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { key: k, uri, size: bytes.length };
}

export async function importUri(srcUri: string, ext: string, key?: string): Promise<StoredRef> {
  await init();
  const k = key ?? `${uid()}.${ext}`;
  const uri = pathFor(k);
  await FileSystem.copyAsync({ from: srcUri, to: uri });
  const info = await FileSystem.getInfoAsync(uri);
  return { key: k, uri, size: info.exists ? (info.size ?? 0) : 0 };
}

export async function readBytes(key: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(pathFor(key), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(b64);
}

export async function getUri(key: string): Promise<string> {
  return pathFor(key);
}

export async function getDataUrl(key: string, mime: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(pathFor(key), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return `data:${mime};base64,${b64}`;
}

export async function remove(key: string): Promise<void> {
  await FileSystem.deleteAsync(pathFor(key), { idempotent: true });
}
