import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';

import { convertFile } from '@/lib/api';
import * as storage from '@/lib/storage';
import type { FileItem } from '@/types';

import {
  fileExtensionFromName,
  imageToUri,
  mimeFromImageName,
  renderWithServer,
  withTimeout,
} from './preview';

vi.mock('@/lib/api', () => ({ convertFile: vi.fn() }));
vi.mock('@/lib/storage', () => ({ getUri: vi.fn() }));

const file: FileItem = {
  id: 'pdf-1',
  name: 'report.pdf',
  kind: 'pdf',
  ext: 'pdf',
  mime: 'application/pdf',
  size: 42,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: 'documents/report.pdf',
  source: 'import',
};

describe('PDF editor preview helpers', () => {
  it('normalizes image extensions and MIME types', () => {
    expect(fileExtensionFromName('Scan.Final.JPEG')).toBe('jpeg');
    expect(fileExtensionFromName('scan', 'webp')).toBe('webp');
    expect(mimeFromImageName('seal.jpg')).toBe('image/jpeg');
    expect(mimeFromImageName('seal.png')).toBe('image/png');
    expect(mimeFromImageName('seal.webp')).toBe('image/webp');
    expect(mimeFromImageName('seal.bmp', 'image/bmp')).toBe('image/bmp');
    expect(mimeFromImageName('seal.bmp')).toBe('image/png');
  });

  it('encodes rendered pages with the correct media type', () => {
    expect(imageToUri({ ext: 'jpg', bytes: new Uint8Array([1, 2, 3]) })).toMatch(/^data:image\/jpeg;base64,/);
    expect(imageToUri({ ext: 'png', bytes: new Uint8Array([1, 2, 3]) })).toMatch(/^data:image\/png;base64,/);
  });

  it('returns timely work and rejects stalled work with the supplied message', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 20, 'slow')).resolves.toBe('ready');
    await expect(withTimeout(new Promise(() => undefined), 1, 'Preview timed out')).rejects.toThrow(
      'Preview timed out',
    );
  });

  it('loads, filters, and naturally sorts server-rendered JPEG pages', async () => {
    const zip = new JSZip();
    zip.file('page-10.jpg', new Uint8Array([10]));
    zip.file('page-2.jpeg', new Uint8Array([2]));
    zip.file('notes.txt', 'ignored');
    zip.folder('empty');
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    vi.mocked(storage.getUri).mockResolvedValue('file:///report.pdf');
    vi.mocked(convertFile).mockResolvedValue({
      bytes,
      filename: 'pages.zip',
      mime: 'application/zip',
    });

    const pages = await renderWithServer(file);

    expect(pages.map((page) => [...page.bytes])).toEqual([[2], [10]]);
    expect(convertFile).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'pdf/render', fileUri: 'file:///report.pdf' }),
    );
  });

  it('rejects an empty render archive', async () => {
    const zip = new JSZip();
    zip.file('readme.txt', 'no pages');
    vi.mocked(storage.getUri).mockResolvedValue('file:///empty.pdf');
    vi.mocked(convertFile).mockResolvedValue({
      bytes: await zip.generateAsync({ type: 'uint8array' }),
      filename: 'empty.zip',
      mime: 'application/zip',
    });

    await expect(renderWithServer(file)).rejects.toThrow('No page previews were returned.');
  });
});
