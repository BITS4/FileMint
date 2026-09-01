import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  makeDirectoryAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { Base64: 'base64' },
  ...fsMock,
}));

async function loadStorage() {
  return import('./storage');
}

describe('native document storage', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const mock of Object.values(fsMock)) mock.mockReset();
    fsMock.makeDirectoryAsync.mockResolvedValue(undefined);
    fsMock.copyAsync.mockResolvedValue(undefined);
    fsMock.deleteAsync.mockResolvedValue(undefined);
    fsMock.writeAsStringAsync.mockResolvedValue(undefined);
  });

  it('initializes its private directory once', async () => {
    const { init } = await loadStorage();

    await Promise.all([init(), init(), init()]);

    expect(fsMock.makeDirectoryAsync).toHaveBeenCalledOnce();
    expect(fsMock.makeDirectoryAsync).toHaveBeenCalledWith('file:///documents/filemint/', {
      intermediates: true,
    });
  });

  it('treats an already-created or unavailable directory as initialized', async () => {
    fsMock.makeDirectoryAsync.mockRejectedValue(new Error('already exists'));
    const { init } = await loadStorage();
    await expect(init()).resolves.toBeUndefined();
  });

  it('writes bytes as base64 and returns a stable supplied key', async () => {
    const { saveBytes } = await loadStorage();
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);

    await expect(saveBytes(bytes, 'pdf', 'document.pdf')).resolves.toEqual({
      key: 'document.pdf',
      uri: 'file:///documents/filemint/document.pdf',
      size: 6,
    });
    expect(fsMock.writeAsStringAsync).toHaveBeenCalledWith(
      'file:///documents/filemint/document.pdf',
      'AAEC/f7/',
      { encoding: 'base64' },
    );
  });

  it('generates a key when the caller does not supply one', async () => {
    const { saveBytes } = await loadStorage();
    const stored = await saveBytes(new Uint8Array([1]), 'png');
    expect(stored.key).toMatch(/^[a-z0-9]+\.png$/);
    expect(stored.uri).toBe(`file:///documents/filemint/${stored.key}`);
  });

  it('imports files and reflects both known and unavailable sizes', async () => {
    const { importUri } = await loadStorage();
    fsMock.getInfoAsync
      .mockResolvedValueOnce({ exists: true, size: 42 })
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: true, size: undefined });

    await expect(importUri('content://picked', 'docx', 'known.docx')).resolves.toMatchObject({ size: 42 });
    await expect(importUri('content://missing', 'docx', 'missing.docx')).resolves.toMatchObject({ size: 0 });
    await expect(importUri('content://unknown', 'docx', 'unknown.docx')).resolves.toMatchObject({ size: 0 });
    expect(fsMock.copyAsync).toHaveBeenNthCalledWith(1, {
      from: 'content://picked',
      to: 'file:///documents/filemint/known.docx',
    });
  });

  it('reads bytes and data URLs and removes files idempotently', async () => {
    const { getDataUrl, getUri, readBytes, remove } = await loadStorage();
    fsMock.readAsStringAsync.mockResolvedValue('AQID');

    await expect(readBytes('sample.bin')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(getDataUrl('sample.bin', 'application/octet-stream')).resolves.toBe(
      'data:application/octet-stream;base64,AQID',
    );
    await expect(getUri('sample.bin')).resolves.toBe('file:///documents/filemint/sample.bin');
    await remove('sample.bin');

    expect(fsMock.readAsStringAsync).toHaveBeenCalledWith('file:///documents/filemint/sample.bin', {
      encoding: 'base64',
    });
    expect(fsMock.deleteAsync).toHaveBeenCalledWith('file:///documents/filemint/sample.bin', {
      idempotent: true,
    });
  });
});
