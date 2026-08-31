import * as Sharing from 'expo-sharing';
import { Alert, Platform } from 'react-native';

import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

function unavailable(message: string): void {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.alert(message);
    return;
  }
  Alert.alert('Unavailable', message);
}

function mimeFor(file: FileItem): string {
  return file.mime || 'application/octet-stream';
}

export function canShareFiles(): boolean {
  if (Platform.OS !== 'web') return true;
  if (typeof window !== 'undefined' && !window.isSecureContext) return false;
  if (typeof navigator === 'undefined' || typeof File === 'undefined') return false;
  return typeof navigator.share === 'function';
}

/** Share a stored library file. On web this uses the browser's real file share API when available. */
export async function shareFile(file: FileItem): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      if (!canShareFiles()) {
        unavailable('Sharing files is not available in this browser. Use Download to save the file.');
        return;
      }
      const bytes = await storage.readBytes(file.storageKey);
      const webFile = new File([bytes as unknown as BlobPart], file.name, { type: mimeFor(file) });
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.share && (!nav.canShare || nav.canShare({ files: [webFile] }))) {
        await nav.share({ title: file.name, text: file.name, files: [webFile] });
        return;
      }
      unavailable(
        'This browser cannot share files directly. Use Download to save the file, then share it from your device.',
      );
      return;
    }

    const uri = await storage.getUri(file.storageKey);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: mimeFor(file), dialogTitle: file.name });
      return;
    }
    unavailable('File sharing is not available on this device.');
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError' || name === 'NotAllowedError') return;
    unavailable('FileMint could not share this file. Try Download instead.');
  }
}

/** Download/export a stored library file. Web downloads; native opens the system export sheet. */
export async function downloadFile(file: FileItem): Promise<void> {
  try {
    const uri = await storage.getUri(file.storageKey);
    if (Platform.OS === 'web') {
      triggerDownload(uri, file.name);
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: mimeFor(file), dialogTitle: `Save ${file.name}` });
      return;
    }
    unavailable('Export is not available on this device.');
  } catch {
    unavailable('FileMint could not download this file.');
  }
}

/** Web-only: trigger a browser download for an object URL / data URL. */
export function triggerDownload(url: string, filename: string): void {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
