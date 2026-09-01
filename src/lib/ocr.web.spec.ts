import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ocrAvailable, recognizeImage } from './ocr.web';

const recognize = vi.hoisted(() => vi.fn());
vi.mock('tesseract.js', () => ({ recognize }));

describe('browser OCR', () => {
  beforeEach(() => recognize.mockReset());

  it('defaults to English, reports recognition progress, and trims output', async () => {
    recognize.mockResolvedValue({ data: { text: '  recognized words\n' } });
    const progress = vi.fn();

    expect(ocrAvailable).toBe(true);
    const result = recognizeImage('blob:scan', '', progress);
    const options = recognize.mock.calls.find((call) => call.length >= 3)?.[2] as {
      logger: (message: { status: string; progress: number }) => void;
    };
    options.logger({ status: 'loading language', progress: 0.2 });
    options.logger({ status: 'recognizing text', progress: 0.75 });
    await expect(result).resolves.toBe('recognized words');
    expect(recognize).toHaveBeenCalledWith(
      'blob:scan',
      'eng',
      expect.objectContaining({ logger: expect.any(Function) }),
    );
    expect(progress).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(0.75);
  });

  it('passes a requested language without requiring a progress callback', async () => {
    recognize.mockResolvedValue({ data: { text: 'Ð¡Ð°Ð»Ð¾Ð¼' } });
    await expect(recognizeImage('blob:tajik', 'tgk')).resolves.toBe('Ð¡Ð°Ð»Ð¾Ð¼');
    expect(recognize.mock.calls[0][1]).toBe('tgk');
  });
});
