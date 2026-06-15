import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { getPageCount } from '@/lib/pdf';
import * as storage from '@/lib/storage';
import { useLibrary } from '@/store/useLibrary';
import type { FileItem, FileSource } from '@/types';

export interface PickedFile {
  uri: string;
  name: string;
  size?: number;
  mime?: string;
}

export async function pickDocuments(opts?: {
  multiple?: boolean;
  type?: string | string[];
}): Promise<PickedFile[]> {
  const res = await DocumentPicker.getDocumentAsync({
    multiple: opts?.multiple ?? false,
    type: opts?.type ?? '*/*',
    copyToCacheDirectory: true,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    name: a.name,
    size: a.size ?? undefined,
    mime: a.mimeType ?? undefined,
  }));
}

export async function pickImages(opts?: { multiple?: boolean }): Promise<PickedFile[]> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return [];
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: opts?.multiple ?? true,
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName ?? `image-${Date.now()}-${i + 1}.jpg`,
    size: a.fileSize ?? undefined,
    mime: a.mimeType ?? 'image/jpeg',
  }));
}

/** Import a picked file into the library and backfill PDF page counts. */
export async function importIntoLibrary(picked: PickedFile, source: FileSource = 'import'): Promise<FileItem> {
  const lib = useLibrary.getState();
  const item = await lib.importPicked({
    uri: picked.uri,
    name: picked.name,
    size: picked.size,
    mime: picked.mime,
    source,
  });
  if (item.kind === 'pdf') {
    try {
      const bytes = await storage.readBytes(item.storageKey);
      const pageCount = await getPageCount(bytes);
      if (pageCount) lib.updateFile(item.id, { pageCount });
    } catch {
      // ignore page-count failures
    }
  }
  return item;
}
