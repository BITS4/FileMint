import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareImageForPdf } from './image';

const mocks = vi.hoisted(() => ({ convertFile: vi.fn(), getUri: vi.fn(), readBytes: vi.fn() }));

vi.mock('./api', () => ({ convertFile: mocks.convertFile }));
vi.mock('./storage', () => ({ getUri: mocks.getUri, readBytes: mocks.readBytes }));

describe('native image preparation', () => {
  beforeEach(() => {
    mocks.convertFile.mockReset();
    mocks.getUri.mockReset().mockResolvedValue('file://stored-image');
    mocks.readBytes.mockReset();
  });

  it('passes JPEG and PNG bytes through when no edits are requested', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    mocks.readBytes.mockResolvedValueOnce(jpeg).mockResolvedValueOnce(png);

    await expect(prepareImageForPdf('photo.jpg', 'jpg')).resolves.toEqual({ bytes: jpeg, ext: 'jpg' });
    await expect(prepareImageForPdf('image.png', 'png', { filter: 'none' })).resolves.toEqual({
      bytes: png,
      ext: 'png',
    });
    expect(mocks.convertFile).not.toHaveBeenCalled();
  });

  it('normalizes edited images through the server with explicit fields', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const normalized = new Uint8Array([137, 80, 78, 71]);
    mocks.readBytes.mockResolvedValue(jpeg);
    mocks.convertFile.mockResolvedValue({ bytes: normalized });

    await expect(
      prepareImageForPdf('photo.jpg', 'jpg', { rotate: 90, filter: 'grayscale' }),
    ).resolves.toEqual({ bytes: normalized, ext: 'png' });
    expect(mocks.convertFile).toHaveBeenCalledWith({
      endpoint: 'image/normalize',
      fileUri: 'file://stored-image',
      fileName: 'image.jpg',
      mime: 'image/jpeg',
      fields: { rotate: 90, filter: 'grayscale' },
    });
  });

  it('wraps normalization failures with detected-format context', async () => {
    mocks.readBytes.mockResolvedValue(new Uint8Array([0x49, 0x49, 0x2a, 0x00]));
    mocks.convertFile.mockRejectedValue(new Error('Pillow is unavailable'));

    await expect(prepareImageForPdf('scan.tiff', 'tiff')).rejects.toThrow(
      'Unsupported image format (tiff). Pillow is unavailable',
    );
  });
});
