/**
 * FileMint conversion server.
 *
 * A small Hono API that shells out to LibreOffice / qpdf / Ghostscript /
 * ocrmypdf for the conversions that cannot run in the client. Every engine is
 * optional: /health reports which ones are available so the app can show honest
 * capability state. Uploaded files are processed in a temp dir and deleted
 * immediately after the response is produced.
 *
 * Run with:  npm run server   (or npm run server:dev for watch mode)
 */
import { readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Hono } from 'hono';

import { registerAuth } from './auth';
import { COLLABORA_URL, WOPI_HOST } from './config';
import { registerEdit } from './edit';
import { registerFeedbackRoutes } from './feedback';
import { registerCoreMiddleware } from './middleware';
import { registerHealthRoute } from './health';
import { registerRedactionRoute } from './redaction';
import { registerSecurityRoutes } from './security';
import { libreConvert, makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import {
  BIN,
  IMAGE_NORMALIZE_SCRIPT,
  PDF2DOCX_SCRIPT,
  PDF_EXPORT_SCRIPT,
  PDF_REPAIR_SCRIPT,
  PDF_UTILITY_SCRIPT,
  PYTHON,
  PY_IMAGE_NORMALIZE,
  PY_PDF_EXPORT,
  PY_PDF_REPAIR,
  PY_PDF_TO_DOCX,
  PY_PDF_UTILITY,
  PY_SEARCHABLE_PDF,
  SEARCHABLE_PDF_SCRIPT,
} from './runtime';

export { CAPABILITIES } from './runtime';

// ------------------------------------------------------------------- routes
export const app = new Hono();
registerCoreMiddleware(app);

registerHealthRoute(app);

registerAuth(app);
registerFeedbackRoutes(app);
registerEdit(app, { collaboraUrl: COLLABORA_URL, wopiHost: WOPI_HOST });

registerRedactionRoute(app);

app.post('/convert', async (c) => {
  const dir = await makeWorkdir();
  try {
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const target = String(body['target'] ?? 'pdf').toLowerCase();
    const inputExt = extname(upload.name).slice(1).toLowerCase();

    let out: string;
    let reportHeader: string | undefined;
    if (inputExt === 'pdf' && target === 'docx') {
      out = join(dir, 'out.docx');
      const reportPath = join(dir, 'report.json');
      const docxMode = String(body['mode'] ?? 'accurate').replace(/[^\w-]/g, '') || 'accurate';
      const docxLang = String(body['language'] ?? 'auto').replace(/[^a-z_+]/gi, '') || 'auto';
      const autoDetectLanguage = String(body['autoDetectLanguage'] ?? 'true') === 'true';
      const tableDetection = String(body['tableDetection'] ?? 'true') === 'true';
      const preserveLayout = String(body['preserveLayout'] ?? 'true') === 'true';
      const keepVisualObjects = String(body['keepVisualObjects'] ?? 'true') === 'true';
      const visualObjectFormat =
        String(body['visualObjectFormat'] ?? 'png')
          .replace(/[^\w-]/g, '')
          .toLowerCase() || 'png';
      const docxQuality =
        String(body['docxQuality'] ?? 'high')
          .replace(/[^\w-]/g, '')
          .toLowerCase() || 'high';
      if (PYTHON && PY_PDF_TO_DOCX) {
        // Layout-aware pipeline: detects digital vs scanned and dispatches
        // pdf2docx / OCR / image per the chosen mode, then writes a quality report.
        const res = await run(
          PYTHON,
          [
            PDF2DOCX_SCRIPT,
            '--input',
            upload.path,
            '--output',
            out,
            '--mode',
            docxMode,
            '--lang',
            docxLang,
            '--auto-detect-language',
            autoDetectLanguage ? 'true' : 'false',
            '--table-detection',
            tableDetection ? 'true' : 'false',
            '--preserve-layout',
            preserveLayout ? 'true' : 'false',
            '--keep-visual-objects',
            keepVisualObjects ? 'true' : 'false',
            '--visual-object-format',
            visualObjectFormat,
            '--docx-quality',
            docxQuality,
            '--report',
            reportPath,
          ],
          600000,
        );
        if (!existsSync(out))
          throw new Error(`PDF → Word failed. ${res.stderr || res.stdout}`.slice(0, 1600));
        if (existsSync(reportPath)) {
          const report = await readFile(reportPath, 'utf8');
          reportHeader = Buffer.from(report, 'utf8').toString('base64url');
        }
      } else if (BIN.pdf2docx) {
        const res = await run(BIN.pdf2docx, ['convert', upload.path, out]);
        reportHeader = Buffer.from(
          JSON.stringify({
            engine: 'pdf2docx-cli',
            requestedMode: docxMode,
            resolvedMode: 'accurate',
            editableTextDetected: true,
            warnings: ['Python report engine is unavailable, so detailed quality reporting is limited.'],
          }),
          'utf8',
        ).toString('base64url');
        if (!existsSync(out))
          throw new Error(`PDF → Word failed. ${res.stderr || res.stdout}`.slice(0, 1600));
      } else {
        throw new Error('PDF → Word needs Python + pdf2docx. Install Python, then run: pip install pdf2docx');
      }
    } else if (inputExt === 'pdf' && (target === 'xlsx' || target === 'pptx' || target === 'html')) {
      if (!PYTHON || !PY_PDF_EXPORT) {
        throw new Error(
          `PDF -> ${target.toUpperCase()} needs the Python export helper. Run: pip install -r server/requirements.lock.txt`,
        );
      }
      out = join(dir, `out.${target}`);
      const reportPath = join(dir, 'report.json');
      const exportLang = String(body['language'] ?? 'auto').replace(/[^a-z_+]/gi, '') || 'auto';
      const tableDetection = String(body['tableDetection'] ?? 'true') === 'true';
      const textLayer = String(body['textLayer'] ?? 'true') === 'true';
      const res = await run(
        PYTHON,
        [
          PDF_EXPORT_SCRIPT,
          '--input',
          upload.path,
          '--output',
          out,
          '--target',
          target,
          '--lang',
          exportLang,
          '--table-detection',
          tableDetection ? 'true' : 'false',
          '--text-layer',
          textLayer ? 'true' : 'false',
          '--report',
          reportPath,
        ],
        600000,
      );
      if (!existsSync(out))
        throw new Error(`PDF -> ${target.toUpperCase()} failed. ${res.stderr || res.stdout}`.slice(0, 400));
      if (existsSync(reportPath)) {
        const report = await readFile(reportPath, 'utf8');
        reportHeader = Buffer.from(report, 'utf8').toString('base64url');
      }
    } else {
      out = await libreConvert(dir, upload, target);
    }

    const downloadName = `${basename(upload.name, extname(upload.name))}.${target}`;
    return await sendFile(
      c,
      dir,
      out,
      downloadName,
      reportHeader ? { 'X-FileMint-Report': reportHeader } : {},
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Conversion failed.' }, 500);
  }
});

app.post('/image/normalize', async (c) => {
  const dir = await makeWorkdir();
  try {
    if (!PYTHON || !PY_IMAGE_NORMALIZE)
      throw new Error(
        'Image normalization needs Python + Pillow. Run: pip install -r server/requirements.lock.txt',
      );
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const rotate = Math.max(0, Math.min(270, Number(body['rotate'] ?? 0) || 0));
    const filter = String(body['filter'] ?? 'none').replace(/[^a-z]/gi, '') || 'none';
    const out = join(dir, 'normalized.png');
    const reportPath = join(dir, 'report.json');
    const res = await run(
      PYTHON,
      [
        IMAGE_NORMALIZE_SCRIPT,
        '--input',
        upload.path,
        '--output',
        out,
        '--rotate',
        String(rotate),
        '--filter',
        filter,
        '--report',
        reportPath,
      ],
      180000,
    );
    if (!existsSync(out))
      throw new Error(`Image normalization failed. ${res.stderr || res.stdout}`.slice(0, 400));
    let reportHeader: string | undefined;
    if (existsSync(reportPath)) {
      const report = await readFile(reportPath, 'utf8');
      reportHeader = Buffer.from(report, 'utf8').toString('base64url');
    }
    return await sendFile(
      c,
      dir,
      out,
      `${basename(upload.name, extname(upload.name))}.png`,
      reportHeader ? { 'X-FileMint-Report': reportHeader } : {},
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Image normalization failed.' }, 500);
  }
});

app.post('/pdf/render', async (c) => {
  const dir = await makeWorkdir();
  try {
    if (!PYTHON || !PY_PDF_UTILITY)
      throw new Error(
        'PDF rendering needs Python + PyMuPDF. Run: pip install -r server/requirements.lock.txt',
      );
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const format = String(body['format'] ?? 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
    const dpi = Math.max(72, Math.min(360, Number(body['dpi'] ?? 180) || 180));
    const out = join(dir, `pages-${format}.zip`);
    const reportPath = join(dir, 'report.json');
    const res = await run(
      PYTHON,
      [
        PDF_UTILITY_SCRIPT,
        '--input',
        upload.path,
        '--output',
        out,
        '--task',
        'images',
        '--format',
        format,
        '--dpi',
        String(dpi),
        '--report',
        reportPath,
      ],
      300000,
    );
    if (!existsSync(out))
      throw new Error(`PDF page rendering failed. ${res.stderr || res.stdout}`.slice(0, 400));
    let reportHeader: string | undefined;
    if (existsSync(reportPath)) {
      const report = await readFile(reportPath, 'utf8');
      reportHeader = Buffer.from(report, 'utf8').toString('base64url');
    }
    return await sendFile(
      c,
      dir,
      out,
      `${basename(upload.name, extname(upload.name))} pages.zip`,
      reportHeader ? { 'X-FileMint-Report': reportHeader } : {},
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'PDF page rendering failed.' }, 500);
  }
});

app.post('/pdf/text', async (c) => {
  const dir = await makeWorkdir();
  try {
    if (!PYTHON || !PY_PDF_UTILITY)
      throw new Error(
        'PDF text extraction needs Python + PyMuPDF. Run: pip install -r server/requirements.lock.txt',
      );
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const lang = String(body['language'] ?? 'auto').replace(/[^a-z_+]/gi, '') || 'auto';
    const out = join(dir, 'out.txt');
    const reportPath = join(dir, 'report.json');
    const res = await run(
      PYTHON,
      [
        PDF_UTILITY_SCRIPT,
        '--input',
        upload.path,
        '--output',
        out,
        '--task',
        'text',
        '--lang',
        lang,
        '--report',
        reportPath,
      ],
      300000,
    );
    if (!existsSync(out))
      throw new Error(`PDF text extraction failed. ${res.stderr || res.stdout}`.slice(0, 400));
    let reportHeader: string | undefined;
    if (existsSync(reportPath)) {
      const report = await readFile(reportPath, 'utf8');
      reportHeader = Buffer.from(report, 'utf8').toString('base64url');
    }
    return await sendFile(
      c,
      dir,
      out,
      `${basename(upload.name, extname(upload.name))}.txt`,
      reportHeader ? { 'X-FileMint-Report': reportHeader } : {},
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'PDF text extraction failed.' }, 500);
  }
});

app.post('/ocr', async (c) => {
  const dir = await makeWorkdir();
  try {
    if (!BIN.ocrmypdf || !PYTHON || !PY_SEARCHABLE_PDF) {
      throw new Error(
        'Searchable PDF needs OCRmyPDF, Python, PyMuPDF and Tesseract. Run: pip install -r server/requirements.lock.txt',
      );
    }
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const lang = String(body['language'] ?? 'auto').replace(/[^a-z_+]/gi, '') || 'auto';
    const force = String(body['forceOcr'] ?? body['force'] ?? 'auto');
    const deskew = String(body['deskew'] ?? 'true') === 'true';
    const rotatePages = String(body['rotatePages'] ?? 'true') === 'true';
    const out = join(dir, 'searchable.pdf');
    const reportPath = join(dir, 'report.json');
    const res = await run(
      PYTHON,
      [
        SEARCHABLE_PDF_SCRIPT,
        '--input',
        upload.path,
        '--output',
        out,
        '--lang',
        lang,
        '--force',
        force,
        '--deskew',
        deskew ? 'true' : 'false',
        '--rotate-pages',
        rotatePages ? 'true' : 'false',
        '--ocrmypdf',
        BIN.ocrmypdf,
        '--report',
        reportPath,
      ],
      600000,
    );
    if (!existsSync(out)) throw new Error(`OCR failed. ${res.stderr || res.stdout}`.slice(0, 800));
    let reportHeader: string | undefined;
    if (existsSync(reportPath)) {
      const report = await readFile(reportPath, 'utf8');
      reportHeader = Buffer.from(report, 'utf8').toString('base64url');
    }
    return await sendFile(
      c,
      dir,
      out,
      `${basename(upload.name, extname(upload.name))} searchable.pdf`,
      reportHeader ? { 'X-FileMint-Report': reportHeader } : {},
    );
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'OCR failed.' }, 500);
  }
});

registerSecurityRoutes(app);

app.post('/repair', async (c) => {
  const dir = await makeWorkdir();
  try {
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const out = join(dir, 'repaired.pdf');
    if (BIN.gs) {
      await run(BIN.gs, ['-o', out, '-sDEVICE=pdfwrite', '-dPDFSETTINGS=/prepress', upload.path]);
    } else if (BIN.qpdf) {
      await run(BIN.qpdf, ['--replace-input', upload.path]).catch(() => undefined);
      await run(BIN.qpdf, [upload.path, out]);
    } else if (PYTHON && PY_PDF_REPAIR) {
      await run(PYTHON, [PDF_REPAIR_SCRIPT, '--input', upload.path, '--output', out]);
    } else {
      throw new Error('PDF repair engine is not installed on the server.');
    }
    if (!existsSync(out)) throw new Error('Repair failed.');
    return await sendFile(c, dir, out, `${basename(upload.name, extname(upload.name))} repaired.pdf`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Repair failed.' }, 500);
  }
});
