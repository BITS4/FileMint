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
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';

import { registerAuth } from './auth';
import { COLLABORA_URL, VERSION, WOPI_HOST } from './config';
import { detectCollabora, getLastCollaboraProbe, registerEdit } from './edit';
import { registerCoreMiddleware } from './middleware';

// ---------------------------------------------------------------- binaries
function resolveBinary(candidates: string[], versionArgs: string[]): string | null {
  for (const cmd of candidates) {
    // An explicit install path that exists is proof enough — running
    // `--version` is unreliable for GUI binaries like Windows' soffice.exe,
    // while the actual work uses headless mode which is fine.
    if (cmd.includes('/') || cmd.includes('\\')) {
      if (existsSync(cmd)) return cmd;
      continue;
    }
    try {
      const res = spawnSync(cmd, versionArgs, { timeout: 8000 });
      if (!res.error && (res.status === 0 || res.stdout?.length || res.stderr?.length)) return cmd;
    } catch {
      // try next
    }
  }
  return null;
}

const isWin = process.platform === 'win32';

/** Find a pip console script (e.g. pdf2docx.exe) in Python Scripts dirs that
 *  pip commonly installs to but doesn't add to PATH on Windows. */
function findWindowsScript(exe: string): string[] {
  if (!isWin) return [];
  const found: string[] = [];
  const roots = [
    join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ];
  for (const root of roots) {
    try {
      for (const dir of readdirSync(root)) {
        if (/^Python/i.test(dir)) {
          const candidate = join(root, dir, 'Scripts', exe);
          if (existsSync(candidate)) found.push(candidate);
        }
      }
    } catch {
      // root doesn't exist
    }
  }
  return found;
}

const BIN = {
  soffice: resolveBinary(
    isWin
      ? [
          // soffice.com is the BLOCKING console launcher — soffice.exe forks and
          // returns before the conversion finishes, producing "corrupt"/missing files.
          'C:\\Program Files\\LibreOffice\\program\\soffice.com',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com',
          'soffice.com',
          'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
          'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        ]
      : ['libreoffice', 'soffice'],
    ['--version'],
  ),
  qpdf: resolveBinary(['qpdf'], ['--version']),
  gs: resolveBinary(isWin ? ['gswin64c', 'gswin32c', 'gs'] : ['gs'], ['--version']),
  ocrmypdf: resolveBinary(['ocrmypdf', ...findWindowsScript('ocrmypdf.exe')], ['--version']),
  // LibreOffice cannot export a PDF back to Office formats (it imports into
  // Draw, which has no Writer/Calc/Impress export filter). pdf2docx (a pip
  // package) is the dedicated engine for PDF -> Word.
  pdf2docx: resolveBinary(['pdf2docx', ...findWindowsScript('pdf2docx.exe')], ['--help']),
};

/** Locate a real Python 3 (skips the Windows Store alias stub, which prints a
 *  "not found" message and would otherwise be mis-detected). */
function findPython(): string | null {
  const candidates: string[] = [];
  if (isWin) {
    const roots = [
      join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ];
    for (const root of roots) {
      try {
        for (const dir of readdirSync(root)) {
          if (/^Python\d/i.test(dir)) {
            const p = join(root, dir, 'python.exe');
            if (existsSync(p)) candidates.push(p);
          }
        }
      } catch {
        // root missing
      }
    }
  }
  candidates.push('python3', 'python');
  for (const c of candidates) {
    if (c.includes('\\') || c.includes('/')) {
      if (existsSync(c)) return c;
      continue;
    }
    try {
      const r = spawnSync(c, ['--version'], { timeout: 5000, encoding: 'utf8' });
      if (!r.error && /Python 3/.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)) return c;
    } catch {
      // try next
    }
  }
  return null;
}

const PYTHON = findPython();
const PDF2DOCX_SCRIPT = fileURLToPath(new URL('./pdf_to_docx.py', import.meta.url));
const PDF_EXPORT_SCRIPT = fileURLToPath(new URL('./pdf_export.py', import.meta.url));
const IMAGE_NORMALIZE_SCRIPT = fileURLToPath(new URL('./image_normalize.py', import.meta.url));
const PDF_UTILITY_SCRIPT = fileURLToPath(new URL('./pdf_utility.py', import.meta.url));
const PDF_SECURITY_SCRIPT = fileURLToPath(new URL('./pdf_security.py', import.meta.url));
const PDF_REPAIR_SCRIPT = fileURLToPath(new URL('./pdf_repair.py', import.meta.url));
const PDF_EDIT_SCRIPT = fileURLToPath(new URL('./pdf_edit.py', import.meta.url));
const SEARCHABLE_PDF_SCRIPT = fileURLToPath(new URL('./searchable_pdf.py', import.meta.url));

function pythonCanImport(modules: string[]): boolean {
  if (!PYTHON) return false;
  try {
    const code = modules.map((m) => `import ${m}`).join('; ');
    const res = spawnSync(PYTHON, ['-c', code], { timeout: 8000 });
    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

const PY_PDF_TO_DOCX = pythonCanImport(['pdf2docx', 'fitz', 'docx']);
const PY_PDF_EXPORT = pythonCanImport(['fitz', 'PIL', 'openpyxl', 'pptx']);
const PY_IMAGE_NORMALIZE = pythonCanImport(['PIL']);
const PY_PDF_UTILITY = pythonCanImport(['fitz']);
const PY_PDF_SECURITY = pythonCanImport(['fitz']);
const PDF_SECURITY_AVAILABLE = !!BIN.qpdf || !!(PYTHON && PY_PDF_SECURITY);
const PY_PDF_REPAIR = pythonCanImport(['fitz']);
const PDF_REPAIR_AVAILABLE = !!BIN.gs || !!BIN.qpdf || !!(PYTHON && PY_PDF_REPAIR);
const PY_PDF_EDIT = pythonCanImport(['fitz']);
const PY_SEARCHABLE_PDF = pythonCanImport(['fitz']);

export const CAPABILITIES = {
  libreoffice: !!BIN.soffice,
  qpdf: PDF_SECURITY_AVAILABLE,
  ghostscript: !!BIN.gs,
  pdfRepair: PDF_REPAIR_AVAILABLE,
  ocr: !!(BIN.ocrmypdf && PYTHON && PY_SEARCHABLE_PDF),
  pdf2docx: !!BIN.pdf2docx || PY_PDF_TO_DOCX,
  pdfExport: !!(PYTHON && PY_PDF_EXPORT),
  imageNormalize: !!(PYTHON && PY_IMAGE_NORMALIZE),
  pdfUtility: !!(PYTHON && PY_PDF_UTILITY),
  pdfEdit: !!(PYTHON && PY_PDF_EDIT),
};

// ------------------------------------------------------------------- utils
function run(
  cmd: string,
  args: string[],
  timeout = 180000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => (stdout += d.toString()));
    proc.stderr?.on('data', (d) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

async function makeWorkdir(): Promise<string> {
  const dir = join(tmpdir(), `filemint-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  zip: 'application/zip',
};

interface Upload {
  path: string;
  name: string;
}

async function saveUpload(dir: string, file: unknown): Promise<Upload> {
  if (!(file instanceof File)) throw new Error('No file uploaded under field "file".');
  const safeName = basename(file.name || 'input').replace(/[^\w.\- ]+/g, '_');
  const path = join(dir, safeName || 'input');
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return { path, name: safeName };
}

/** Send a produced file then delete the working directory. */
async function sendFile(
  c: import('hono').Context,
  dir: string,
  filePath: string,
  downloadName: string,
  extraHeaders: Record<string, string> = {},
) {
  const bytes = await readFile(filePath);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  const ext = extname(downloadName).slice(1).toLowerCase();
  return c.body(new Uint8Array(bytes), 200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    'Access-Control-Expose-Headers': 'Content-Disposition, X-FileMint-Report',
    ...extraHeaders,
  });
}

async function libreConvert(dir: string, input: Upload, targetExt: string): Promise<string> {
  if (!BIN.soffice) throw new Error('LibreOffice is not installed on the server.');
  const profile = `-env:UserInstallation=${pathToFileURL(join(dir, 'lo-profile')).href}`;
  const res = await run(BIN.soffice, [
    '--headless',
    profile,
    '--convert-to',
    targetExt,
    '--outdir',
    dir,
    input.path,
  ]);
  // LibreOffice writes <base>.<targetExt> into outdir
  const base = basename(input.name, extname(input.name));
  const candidate = join(dir, `${base}.${targetExt}`);
  if (existsSync(candidate)) return candidate;
  // Fallback: find any newly produced file with the target extension.
  const files = await readdir(dir);
  const match = files.find((f) => f.toLowerCase().endsWith(`.${targetExt}`) && f !== basename(input.path));
  if (match) return join(dir, match);
  throw new Error(`Conversion failed. ${res.stderr || res.stdout}`.slice(0, 300));
}

// ------------------------------------------------------------------- routes
export const app = new Hono();
registerCoreMiddleware(app);

// Collabora runs in Docker and comes/goes independently — poll it in the
// background so /health reflects current availability without slowing down.
let collaboraOnline = false;
let collaboraRefreshInFlight = false;
const refreshCollabora = () => {
  if (collaboraRefreshInFlight) return;
  collaboraRefreshInFlight = true;
  detectCollabora(COLLABORA_URL)
    .then((v) => {
      collaboraOnline = v;
    })
    .catch(() => undefined)
    .finally(() => {
      collaboraRefreshInFlight = false;
    });
};
refreshCollabora();
const collaboraTimer = setInterval(refreshCollabora, 30000);
if (typeof collaboraTimer.unref === 'function') collaboraTimer.unref();

app.get('/health', (c) =>
  c.json({
    version: VERSION,
    capabilities: { ...CAPABILITIES, collabora: collaboraOnline, auth: true, premium: true },
    services: {
      collabora: getLastCollaboraProbe() ?? {
        online: collaboraOnline,
        url: COLLABORA_URL,
        checkedAt: null,
      },
    },
  }),
);

registerAuth(app);
registerEdit(app, { collaboraUrl: COLLABORA_URL, wopiHost: WOPI_HOST });

app.post('/edit/redact', async (c) => {
  const dir = await makeWorkdir();
  try {
    if (!PYTHON || !PY_PDF_EDIT)
      throw new Error('PDF redaction needs Python + PyMuPDF. Run: pip install -r server/requirements.txt');
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const out = join(dir, 'redacted.pdf');
    const areasJson = String(body['areasJson'] ?? '[]');
    const color =
      String(body['color'] ?? '#000000')
        .replace(/[^#a-fA-F0-9]/g, '')
        .slice(0, 7) || '#000000';
    const label = String(body['label'] ?? 'Redacted').slice(0, 80);
    const res = await run(
      PYTHON,
      [
        PDF_EDIT_SCRIPT,
        '--task',
        'redact',
        '--input',
        upload.path,
        '--output',
        out,
        '--areas-json',
        areasJson,
        '--color',
        color,
        '--label',
        label,
      ],
      300000,
    );
    if (!existsSync(out)) throw new Error(`Redaction failed. ${res.stderr || res.stdout}`.slice(0, 400));
    return await sendFile(c, dir, out, `${basename(upload.name, extname(upload.name))} redacted.pdf`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Redaction failed.' }, 500);
  }
});

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
          `PDF -> ${target.toUpperCase()} needs the Python export helper. Run: pip install -r server/requirements.txt`,
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
        'Image normalization needs Python + Pillow. Run: pip install -r server/requirements.txt',
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
      throw new Error('PDF rendering needs Python + PyMuPDF. Run: pip install -r server/requirements.txt');
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
        'PDF text extraction needs Python + PyMuPDF. Run: pip install -r server/requirements.txt',
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
        'Searchable PDF needs OCRmyPDF, Python, PyMuPDF and Tesseract. Run: pip install -r server/requirements.txt',
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

app.post('/secure/lock', async (c) => {
  const dir = await makeWorkdir();
  try {
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const password = String(body['password'] ?? '');
    if (!password) throw new Error('A password is required.');
    const out = join(dir, 'locked.pdf');
    let res: { stderr: string; stdout: string } = { stderr: '', stdout: '' };
    if (BIN.qpdf) {
      res = await run(BIN.qpdf, ['--encrypt', password, password, '256', '--', upload.path, out]);
    } else if (PYTHON && PY_PDF_SECURITY) {
      res = await run(PYTHON, [
        PDF_SECURITY_SCRIPT,
        '--task',
        'lock',
        '--input',
        upload.path,
        '--output',
        out,
        '--password',
        password,
      ]);
    } else {
      throw new Error('PDF security engine is not installed on the server.');
    }
    if (!existsSync(out)) throw new Error(`Lock failed. ${res.stderr}`.slice(0, 300));
    return await sendFile(c, dir, out, `${basename(upload.name, extname(upload.name))} locked.pdf`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Lock failed.' }, 500);
  }
});

app.post('/secure/unlock', async (c) => {
  const dir = await makeWorkdir();
  try {
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const password = String(body['password'] ?? '');
    const out = join(dir, 'unlocked.pdf');
    let res: { stderr: string; stdout: string } = { stderr: '', stdout: '' };
    if (BIN.qpdf) {
      res = await run(BIN.qpdf, [`--password=${password}`, '--decrypt', upload.path, out]);
    } else if (PYTHON && PY_PDF_SECURITY) {
      res = await run(PYTHON, [
        PDF_SECURITY_SCRIPT,
        '--task',
        'unlock',
        '--input',
        upload.path,
        '--output',
        out,
        '--password',
        password,
      ]);
    } else {
      throw new Error('PDF security engine is not installed on the server.');
    }
    if (!existsSync(out)) throw new Error(`Unlock failed — wrong password? ${res.stderr}`.slice(0, 300));
    return await sendFile(c, dir, out, `${basename(upload.name, extname(upload.name))} unlocked.pdf`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Unlock failed.' }, 500);
  }
});

app.post('/secure/permissions', async (c) => {
  const dir = await makeWorkdir();
  try {
    const body = await c.req.parseBody();
    const upload = await saveUpload(dir, body['file']);
    const owner = String(body['ownerPassword'] ?? '');
    if (!owner) throw new Error('An owner password is required.');
    const allowPrint = String(body['allowPrint'] ?? 'false') === 'true';
    const allowCopy = String(body['allowCopy'] ?? 'false') === 'true';
    const out = join(dir, 'protected.pdf');
    let res: { stderr: string; stdout: string } = { stderr: '', stdout: '' };
    if (BIN.qpdf) {
      res = await run(BIN.qpdf, [
        '--encrypt',
        '',
        owner,
        '256',
        `--print=${allowPrint ? 'full' : 'none'}`,
        `--extract=${allowCopy ? 'y' : 'n'}`,
        '--modify=none',
        '--',
        upload.path,
        out,
      ]);
    } else if (PYTHON && PY_PDF_SECURITY) {
      res = await run(PYTHON, [
        PDF_SECURITY_SCRIPT,
        '--task',
        'permissions',
        '--input',
        upload.path,
        '--output',
        out,
        '--owner-password',
        owner,
        ...(allowPrint ? ['--allow-print'] : []),
        ...(allowCopy ? ['--allow-copy'] : []),
      ]);
    } else {
      throw new Error('PDF security engine is not installed on the server.');
    }
    if (!existsSync(out)) throw new Error(`Failed. ${res.stderr}`.slice(0, 300));
    return await sendFile(c, dir, out, `${basename(upload.name, extname(upload.name))} protected.pdf`);
  } catch (e) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return c.json({ error: e instanceof Error ? e.message : 'Failed.' }, 500);
  }
});

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
