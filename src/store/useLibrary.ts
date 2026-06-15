import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { extFromName, kindFromExt, kindFromMime, uniqueName } from '@/lib/format';
import * as storage from '@/lib/storage';
import { uid } from '@/lib/uid';
import type { AccentName } from '@/constants/theme';
import type { ConversionReport, FileItem, FileKind, FileSource, Folder } from '@/types';

interface SaveResultInput {
  bytes: Uint8Array;
  name: string;
  kind?: FileKind;
  ext?: string;
  mime?: string;
  pageCount?: number;
  source?: FileSource;
  folderId?: string | null;
  thumbnailUri?: string;
  conversionReport?: ConversionReport;
}

interface ImportInput {
  uri: string;
  name: string;
  size?: number;
  mime?: string;
  source?: FileSource;
  folderId?: string | null;
}

interface LibraryState {
  files: FileItem[];
  folders: Folder[];
  hydrated: boolean;

  saveResult: (input: SaveResultInput) => Promise<FileItem>;
  importPicked: (input: ImportInput) => Promise<FileItem>;
  duplicateFile: (id: string) => Promise<FileItem | undefined>;
  replaceFileBytes: (id: string, bytes: Uint8Array) => Promise<void>;

  updateFile: (id: string, patch: Partial<FileItem>) => void;
  renameFile: (id: string, name: string) => void;
  toggleFavorite: (id: string) => void;
  touch: (id: string) => void;
  trashFile: (id: string) => void;
  restoreFile: (id: string) => void;
  deleteForever: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  clearLibrary: () => Promise<void>;
  moveToFolder: (id: string, folderId: string | null) => void;

  addFolder: (name: string, color?: AccentName) => Folder;
  renameFolder: (id: string, name: string) => void;
  removeFolder: (id: string) => void;
}

function existingNames(files: FileItem[]): string[] {
  return files.map((f) => f.name);
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set, get) => ({
      files: [],
      folders: [],
      hydrated: false,

      saveResult: async (input) => {
        const ext = (input.ext ?? extFromName(input.name) ?? 'pdf').toLowerCase();
        const kind = input.kind ?? kindFromExt(ext);
        const ref = await storage.saveBytes(input.bytes, ext);
        const now = Date.now();
        const name = uniqueName(input.name, existingNames(get().files));
        const item: FileItem = {
          id: uid('f_'),
          name,
          kind,
          ext,
          mime: input.mime,
          size: ref.size,
          pageCount: input.pageCount,
          createdAt: now,
          modifiedAt: now,
          favorite: false,
          folderId: input.folderId ?? null,
          storageKey: ref.key,
          thumbnailUri: input.thumbnailUri,
          conversionReport: input.conversionReport,
          source: input.source ?? 'created',
        };
        set((s) => ({ files: [item, ...s.files] }));
        return item;
      },

      importPicked: async (input) => {
        const ext = extFromName(input.name).toLowerCase() || 'bin';
        const kind = kindFromMime(input.mime) ?? kindFromExt(ext);
        const ref = await storage.importUri(input.uri, ext);
        const now = Date.now();
        const name = uniqueName(input.name, existingNames(get().files));
        const item: FileItem = {
          id: uid('f_'),
          name,
          kind,
          ext,
          mime: input.mime,
          size: input.size ?? ref.size,
          createdAt: now,
          modifiedAt: now,
          favorite: false,
          folderId: input.folderId ?? null,
          storageKey: ref.key,
          source: input.source ?? 'import',
        };
        set((s) => ({ files: [item, ...s.files] }));
        return item;
      },

      duplicateFile: async (id) => {
        const original = get().files.find((f) => f.id === id);
        if (!original) return undefined;
        const bytes = await storage.readBytes(original.storageKey);
        const ref = await storage.saveBytes(bytes, original.ext);
        const now = Date.now();
        const name = uniqueName(`${baseName(original.name)} copy.${original.ext}`, existingNames(get().files));
        const item: FileItem = {
          ...original,
          id: uid('f_'),
          name,
          storageKey: ref.key,
          favorite: false,
          createdAt: now,
          modifiedAt: now,
          trashed: false,
          trashedAt: undefined,
        };
        set((s) => ({ files: [item, ...s.files] }));
        return item;
      },

      replaceFileBytes: async (id, bytes) => {
        const file = get().files.find((f) => f.id === id);
        if (!file) return;
        await storage.saveBytes(bytes, file.ext, file.storageKey);
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, size: bytes.length, modifiedAt: Date.now() } : f)),
        }));
      },

      updateFile: (id, patch) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, ...patch, modifiedAt: Date.now() } : f)),
        })),

      renameFile: (id, name) =>
        set((s) => {
          const others = s.files.filter((f) => f.id !== id).map((f) => f.name);
          const safe = uniqueName(name, others);
          return {
            files: s.files.map((f) => (f.id === id ? { ...f, name: safe, modifiedAt: Date.now() } : f)),
          };
        }),

      toggleFavorite: (id) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, favorite: !f.favorite } : f)),
        })),

      touch: (id) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, modifiedAt: Date.now() } : f)),
        })),

      trashFile: (id) =>
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, trashed: true, trashedAt: Date.now(), favorite: false } : f,
          ),
        })),

      restoreFile: (id) =>
        set((s) => ({
          files: s.files.map((f) =>
            f.id === id ? { ...f, trashed: false, trashedAt: undefined } : f,
          ),
        })),

      deleteForever: async (id) => {
        const file = get().files.find((f) => f.id === id);
        if (file) await storage.remove(file.storageKey).catch(() => undefined);
        set((s) => ({ files: s.files.filter((f) => f.id !== id) }));
      },

      emptyTrash: async () => {
        const trashed = get().files.filter((f) => f.trashed);
        await Promise.all(trashed.map((f) => storage.remove(f.storageKey).catch(() => undefined)));
        set((s) => ({ files: s.files.filter((f) => !f.trashed) }));
      },

      clearLibrary: async () => {
        const all = get().files;
        await Promise.all(all.map((f) => storage.remove(f.storageKey).catch(() => undefined)));
        set({ files: [], folders: [] });
      },

      moveToFolder: (id, folderId) =>
        set((s) => ({
          files: s.files.map((f) => (f.id === id ? { ...f, folderId } : f)),
        })),

      addFolder: (name, color) => {
        const folder: Folder = { id: uid('d_'), name, color, createdAt: Date.now() };
        set((s) => ({ folders: [...s.folders, folder] }));
        return folder;
      },

      renameFolder: (id, name) =>
        set((s) => ({ folders: s.folders.map((d) => (d.id === id ? { ...d, name } : d)) })),

      removeFolder: (id) =>
        set((s) => ({
          folders: s.folders.filter((d) => d.id !== id),
          files: s.files.map((f) => (f.folderId === id ? { ...f, folderId: null } : f)),
        })),
    }),
    {
      name: 'filemint-library',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ files: s.files, folders: s.folders }),
      onRehydrateStorage: () => (state) => {
        if (state) state.hydrated = true;
      },
    },
  ),
);

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

// -------------------------------------------------------------- selectors
export const selectActiveFiles = (s: LibraryState) => s.files.filter((f) => !f.trashed);
export const selectTrashed = (s: LibraryState) => s.files.filter((f) => f.trashed);
export const selectFavorites = (s: LibraryState) => s.files.filter((f) => !f.trashed && f.favorite);
