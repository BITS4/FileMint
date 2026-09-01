export const PDFJS_WORKER_PATH = '/pdf.worker.min.mjs';

interface PdfJsWorkerOptions {
  workerSrc: string;
}

interface PdfJsRuntime {
  GlobalWorkerOptions: PdfJsWorkerOptions;
}

/** Configure PDF.js to use the worker copied from the locked npm dependency. */
export function configurePdfJsWorker(runtime: PdfJsRuntime): string {
  runtime.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_PATH;
  return PDFJS_WORKER_PATH;
}
