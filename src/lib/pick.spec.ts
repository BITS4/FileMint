import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importIntoLibrary, pickDocuments, pickImages } from './pick';

const mocks = vi.hoisted(() => ({
  getDocumentAsync: vi.fn(),
  getPageCount: vi.fn(),
  importPicked: vi.fn(),
  launchImageLibraryAsync: vi.fn(),
  readBytes: vi.fn(),
  requestMediaLibraryPermissionsAsync: vi.fn(),
  updateFile: vi.fn(),
}));

vi.mock('expo-document-picker', () => ({ getDocumentAsync: mocks.getDocumentAsync }));
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: mocks.launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync: mocks.requestMediaLibraryPermissionsAsync,
}));
vi.mock('@/lib/pdf', () => ({ getPageCount: mocks.getPageCount }));
vi.mock('@/lib/storage', () => ({ readBytes: mocks.readBytes }));
vi.mock('@/store/useLibrary', () => ({
  useLibrary: {
    getState: () => ({ importPicked: mocks.importPicked, updateFile: mocks.updateFile }),
  },
}));

const importedFile = {
  id: 'file-1',
  name: 'picked.pdf',
  kind: 'pdf' as const,
  ext: 'pdf',
  size: 3,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: 'stored.pdf',
  source: 'import' as const,
};

describe('file pickers and library import', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('passes document picker options and maps nullable asset metadata', async () => {
    mocks.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://one.pdf', name: 'one.pdf', size: null, mimeType: null },
        { uri: 'file://two.docx', name: 'two.docx', size: 7, mimeType: 'application/docx' },
      ],
    });

    await expect(pickDocuments({ multiple: true, type: ['application/pdf'] })).resolves.toEqual([
      { uri: 'file://one.pdf', name: 'one.pdf', size: undefined, mime: undefined },
      { uri: 'file://two.docx', name: 'two.docx', size: 7, mime: 'application/docx' },
    ]);
    expect(mocks.getDocumentAsync).toHaveBeenCalledWith({
      multiple: true,
      type: ['application/pdf'],
      copyToCacheDirectory: true,
    });

    mocks.getDocumentAsync.mockResolvedValueOnce({ canceled: true });
    await expect(pickDocuments()).resolves.toEqual([]);
  });

  it('does not open the image library when media permission is denied', async () => {
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });

    await expect(pickImages()).resolves.toEqual([]);
    expect(mocks.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('maps image assets and generates a deterministic fallback name and MIME type', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
    mocks.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    mocks.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file://one', fileName: null, fileSize: null, mimeType: null },
        { uri: 'file://two', fileName: 'photo.webp', fileSize: 12, mimeType: 'image/webp' },
      ],
    });

    const result = await pickImages({ multiple: false });

    expect(result[0]).toEqual({
      uri: 'file://one',
      name: `image-${Date.now()}-1.jpg`,
      size: undefined,
      mime: 'image/jpeg',
    });
    expect(result[1]).toEqual({ uri: 'file://two', name: 'photo.webp', size: 12, mime: 'image/webp' });
    expect(mocks.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
      exif: false,
    });
  });

  it('backfills the PDF page count after a successful import', async () => {
    mocks.importPicked.mockResolvedValue(importedFile);
    mocks.readBytes.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.getPageCount.mockResolvedValue(6);

    await expect(
      importIntoLibrary({ uri: 'file://picked.pdf', name: 'picked.pdf', size: 3 }, 'scan'),
    ).resolves.toBe(importedFile);
    expect(mocks.importPicked).toHaveBeenCalledWith({
      uri: 'file://picked.pdf',
      name: 'picked.pdf',
      size: 3,
      mime: undefined,
      source: 'scan',
    });
    expect(mocks.updateFile).toHaveBeenCalledWith('file-1', { pageCount: 6 });
  });

  it('skips page inspection for non-PDFs and tolerates corrupt PDFs', async () => {
    mocks.importPicked
      .mockResolvedValueOnce({ ...importedFile, kind: 'image' })
      .mockResolvedValueOnce(importedFile);
    mocks.readBytes.mockRejectedValue(new Error('corrupt'));

    await expect(importIntoLibrary({ uri: 'file://image.png', name: 'image.png' })).resolves.toMatchObject({
      kind: 'image',
    });
    expect(mocks.readBytes).not.toHaveBeenCalled();

    await expect(importIntoLibrary({ uri: 'file://bad.pdf', name: 'bad.pdf' })).resolves.toBe(importedFile);
    expect(mocks.updateFile).not.toHaveBeenCalled();
  });
});
