import { describe, expect, it } from 'vitest';

import { configurePdfJsWorker, PDFJS_WORKER_PATH } from './pdfjs-worker';

describe('PDF.js worker configuration', () => {
  it('uses the self-hosted worker copied from the locked dependency', () => {
    const runtime = { GlobalWorkerOptions: { workerSrc: 'https://third-party.invalid/worker.mjs' } };

    expect(configurePdfJsWorker(runtime)).toBe('/pdf.worker.min.mjs');
    expect(runtime.GlobalWorkerOptions.workerSrc).toBe(PDFJS_WORKER_PATH);
  });
});
