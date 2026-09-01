import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canShareFiles, downloadFile, shareFile, triggerDownload } from './share';

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  getUri: vi.fn(),
  isAvailableAsync: vi.fn(),
  platform: { OS: 'web' },
  readBytes: vi.fn(),
  shareAsync: vi.fn(),
}));

vi.mock('expo-sharing', () => ({
  isAvailableAsync: mocks.isAvailableAsync,
  shareAsync: mocks.shareAsync,
}));
vi.mock('react-native', () => ({
  Alert: { alert: mocks.alert },
  Platform: mocks.platform,
}));
vi.mock('@/lib/storage', () => ({
  getUri: mocks.getUri,
  readBytes: mocks.readBytes,
}));

const file = {
  id: 'file-1',
  name: 'Report.pdf',
  kind: 'pdf' as const,
  ext: 'pdf',
  mime: 'application/pdf',
  size: 3,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: 'report.pdf',
  source: 'created' as const,
};

describe('file sharing and downloads', () => {
  beforeEach(() => {
    mocks.platform.OS = 'web';
    mocks.alert.mockReset();
    mocks.getUri.mockReset().mockResolvedValue('blob:report');
    mocks.isAvailableAsync.mockReset();
    mocks.readBytes.mockReset().mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.shareAsync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects web sharing in an insecure context with an actionable message', async () => {
    const webAlert = vi.fn();
    vi.stubGlobal('window', { isSecureContext: false, alert: webAlert });
    vi.stubGlobal('navigator', { share: vi.fn() });

    expect(canShareFiles()).toBe(false);
    await shareFile(file);

    expect(webAlert).toHaveBeenCalledWith(
      'Sharing files is not available in this browser. Use Download to save the file.',
    );
    expect(mocks.readBytes).not.toHaveBeenCalled();
  });

  it('shares stored bytes with the browser file API when supported', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    vi.stubGlobal('window', { isSecureContext: true, alert: vi.fn() });
    vi.stubGlobal('navigator', { share, canShare });

    expect(canShareFiles()).toBe(true);
    await shareFile(file);

    expect(canShare).toHaveBeenCalledWith({ files: [expect.any(File)] });
    expect(share).toHaveBeenCalledWith({
      title: 'Report.pdf',
      text: 'Report.pdf',
      files: [expect.objectContaining({ name: 'Report.pdf', type: 'application/pdf' })],
    });
  });

  it('explains when a secure browser refuses file payload sharing', async () => {
    const webAlert = vi.fn();
    vi.stubGlobal('window', { isSecureContext: true, alert: webAlert });
    vi.stubGlobal('navigator', { share: vi.fn(), canShare: vi.fn(() => false) });

    await shareFile(file);

    expect(webAlert).toHaveBeenCalledWith(
      'This browser cannot share files directly. Use Download to save the file, then share it from your device.',
    );
  });

  it('uses the native sharing sheet and falls back cleanly when unavailable', async () => {
    mocks.platform.OS = 'ios';
    mocks.isAvailableAsync.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    await shareFile(file);
    expect(mocks.shareAsync).toHaveBeenCalledWith('blob:report', {
      mimeType: 'application/pdf',
      dialogTitle: 'Report.pdf',
    });

    await downloadFile({ ...file, mime: undefined });
    expect(mocks.alert).toHaveBeenCalledWith('Unavailable', 'Export is not available on this device.');
  });

  it('suppresses user-cancel errors but reports unexpected sharing failures', async () => {
    const webAlert = vi.fn();
    const share = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('canceled'), { name: 'AbortError' }))
      .mockRejectedValueOnce(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
      .mockRejectedValueOnce(new Error('browser failure'));
    vi.stubGlobal('window', { isSecureContext: true, alert: webAlert });
    vi.stubGlobal('navigator', { share });

    await shareFile(file);
    expect(webAlert).not.toHaveBeenCalled();
    await shareFile(file);
    expect(webAlert).not.toHaveBeenCalled();
    await shareFile(file);
    expect(webAlert).toHaveBeenCalledWith('FileMint could not share this file. Try Download instead.');
  });

  it('uses the native export sheet and reports download failures', async () => {
    mocks.platform.OS = 'android';
    mocks.isAvailableAsync.mockResolvedValue(true);

    await downloadFile(file);
    expect(mocks.shareAsync).toHaveBeenCalledWith('blob:report', {
      mimeType: 'application/pdf',
      dialogTitle: 'Save Report.pdf',
    });

    mocks.getUri.mockRejectedValue(new Error('storage failure'));
    await downloadFile(file);
    expect(mocks.alert).toHaveBeenCalledWith('Unavailable', 'FileMint could not download this file.');
  });

  it('creates and removes a temporary web download anchor', async () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const anchor = { href: '', download: '', click, remove };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild },
    });

    triggerDownload('blob:report', 'Report.pdf');
    expect(anchor).toMatchObject({ href: 'blob:report', download: 'Report.pdf' });
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();

    await downloadFile(file);
    expect(click).toHaveBeenCalledTimes(2);
  });
});
