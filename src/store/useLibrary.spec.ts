import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileItem } from '@/types';
import { selectActiveFiles, selectFavorites, selectTrashed, useLibrary } from './useLibrary';

const mocks = vi.hoisted(() => ({
  asyncStorage: { getItem: vi.fn(), removeItem: vi.fn(), setItem: vi.fn() },
  importUri: vi.fn(),
  readBytes: vi.fn(),
  remove: vi.fn(),
  saveBytes: vi.fn(),
  uid: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({ default: mocks.asyncStorage }));
vi.mock('@/lib/storage', () => ({
  importUri: mocks.importUri,
  readBytes: mocks.readBytes,
  remove: mocks.remove,
  saveBytes: mocks.saveBytes,
}));
vi.mock('@/lib/uid', () => ({ uid: mocks.uid }));

function file(overrides: Partial<FileItem> = {}): FileItem {
  return {
    id: 'file-1',
    name: 'Report.pdf',
    kind: 'pdf',
    ext: 'pdf',
    mime: 'application/pdf',
    size: 3,
    createdAt: 100,
    modifiedAt: 100,
    favorite: false,
    folderId: null,
    storageKey: 'report.pdf',
    source: 'created',
    ...overrides,
  };
}

describe('document library store', () => {
  beforeEach(() => {
    useLibrary.setState({ files: [], folders: [], hydrated: true });
    mocks.importUri.mockReset().mockResolvedValue({ key: 'imported.docx', uri: 'file://imported', size: 24 });
    mocks.readBytes.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.remove.mockReset().mockResolvedValue(undefined);
    mocks.saveBytes.mockReset().mockResolvedValue({ key: 'saved.pdf', uri: 'file://saved', size: 3 });
    mocks.uid.mockReset().mockReturnValue('generated-id');
  });

  afterEach(() => vi.useRealTimers());

  it('saves results with inferred metadata and collision-free names', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    useLibrary.setState({ files: [file()], folders: [], hydrated: true });

    const saved = await useLibrary
      .getState()
      .saveResult({ bytes: new Uint8Array([4, 5, 6]), name: 'Report.pdf' });

    expect(saved).toMatchObject({
      id: 'generated-id',
      name: 'Report (2).pdf',
      kind: 'pdf',
      ext: 'pdf',
      size: 3,
      createdAt: 1_000,
      modifiedAt: 1_000,
      favorite: false,
      folderId: null,
      storageKey: 'saved.pdf',
      source: 'created',
    });
    expect(useLibrary.getState().files[0]).toEqual(saved);
  });

  it('imports picked documents and honors the picker size over storage metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000);

    const imported = await useLibrary.getState().importPicked({
      uri: 'content://document',
      name: 'Budget.DOCX',
      size: 99,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      folderId: 'work',
    });

    expect(mocks.importUri).toHaveBeenCalledWith('content://document', 'docx');
    expect(imported).toMatchObject({
      name: 'Budget.DOCX',
      ext: 'docx',
      kind: 'word',
      size: 99,
      folderId: 'work',
      source: 'import',
    });

    const withStorageSize = await useLibrary.getState().importPicked({
      uri: 'content://second',
      name: 'notes.txt',
    });
    expect(withStorageSize.size).toBe(24);
  });

  it('duplicates a stored file while clearing transient flags', async () => {
    useLibrary.setState({
      files: [file({ favorite: true, trashed: true, trashedAt: 50 })],
      folders: [],
      hydrated: true,
    });
    mocks.saveBytes.mockResolvedValue({ key: 'copy.pdf', uri: 'file://copy', size: 3 });

    await expect(useLibrary.getState().duplicateFile('missing')).resolves.toBeUndefined();
    const duplicate = await useLibrary.getState().duplicateFile('file-1');

    expect(mocks.readBytes).toHaveBeenCalledWith('report.pdf');
    expect(duplicate).toMatchObject({
      id: 'generated-id',
      name: 'Report copy.pdf',
      storageKey: 'copy.pdf',
      favorite: false,
      trashed: false,
      trashedAt: undefined,
    });
  });

  it('updates bytes and manages file metadata through its lifecycle', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(3_000);
    useLibrary.setState({
      files: [file(), file({ id: 'file-2', name: 'Existing.pdf' })],
      folders: [],
      hydrated: true,
    });

    await expect(
      useLibrary.getState().replaceFileBytes('missing', new Uint8Array([1])),
    ).resolves.toBeUndefined();
    await useLibrary.getState().replaceFileBytes('file-1', new Uint8Array([9, 8]));
    useLibrary.getState().updateFile('file-1', { pageCount: 7 });
    useLibrary.getState().renameFile('file-1', 'Existing.pdf');
    useLibrary.getState().toggleFavorite('file-1');
    useLibrary.getState().touch('file-1');
    useLibrary.getState().moveToFolder('file-1', 'folder-1');
    useLibrary.getState().trashFile('file-1');
    useLibrary.getState().restoreFile('file-1');

    expect(mocks.saveBytes).toHaveBeenCalledWith(new Uint8Array([9, 8]), 'pdf', 'report.pdf');
    expect(useLibrary.getState().files.find((item) => item.id === 'file-1')).toMatchObject({
      name: 'Existing (2).pdf',
      size: 2,
      pageCount: 7,
      favorite: false,
      folderId: 'folder-1',
      trashed: false,
      trashedAt: undefined,
      modifiedAt: 3_000,
    });
  });

  it('deletes permanent and trashed files even when storage cleanup fails', async () => {
    useLibrary.setState({
      files: [file(), file({ id: 'trash', storageKey: 'trash.pdf', trashed: true })],
      folders: [],
      hydrated: true,
    });
    mocks.remove.mockRejectedValue(new Error('already gone'));

    await useLibrary.getState().deleteForever('missing');
    await useLibrary.getState().deleteForever('file-1');
    expect(useLibrary.getState().files.map((item) => item.id)).toEqual(['trash']);
    await useLibrary.getState().emptyTrash();
    expect(useLibrary.getState().files).toEqual([]);
  });

  it('creates, renames, removes, and clears folders consistently', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(4_000);
    useLibrary.setState({ files: [file({ folderId: 'generated-id' })], folders: [], hydrated: true });

    const folder = useLibrary.getState().addFolder('Invoices', 'amber');
    expect(folder).toEqual({ id: 'generated-id', name: 'Invoices', color: 'amber', createdAt: 4_000 });
    useLibrary.getState().renameFolder(folder.id, 'Paid invoices');
    useLibrary.getState().removeFolder(folder.id);
    expect(useLibrary.getState().folders).toEqual([]);
    expect(useLibrary.getState().files[0].folderId).toBeNull();

    await useLibrary.getState().clearLibrary();
    expect(useLibrary.getState()).toMatchObject({ files: [], folders: [] });
  });

  it('selects active, trashed, and favorite documents independently', () => {
    const active = file();
    const favorite = file({ id: 'favorite', favorite: true });
    const trashed = file({ id: 'trashed', trashed: true, favorite: true });
    const state = { ...useLibrary.getState(), files: [active, favorite, trashed] };

    expect(selectActiveFiles(state).map((item) => item.id)).toEqual(['file-1', 'favorite']);
    expect(selectTrashed(state).map((item) => item.id)).toEqual(['trashed']);
    expect(selectFavorites(state).map((item) => item.id)).toEqual(['favorite']);
  });
});
