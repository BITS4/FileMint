import { describe, expect, it } from 'vitest';
import { ocrAvailable, recognizeImage } from './ocr';

describe('native OCR boundary', () => {
  it('advertises the server-backed limitation with a useful error', async () => {
    expect(ocrAvailable).toBe(false);
    await expect(recognizeImage('file://scan.png', 'eng')).rejects.toThrow(
      'On-device OCR runs in the FileMint web app',
    );
  });
});
