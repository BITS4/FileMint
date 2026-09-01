/** Runtime engine discovery and capability reporting. */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------- binaries
export function resolveBinary(candidates: string[], versionArgs: string[]): string | null {
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
export function findWindowsScript(exe: string): string[] {
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

export const BIN = {
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
export function findPython(): string | null {
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

export const PYTHON = findPython();
export const PDF2DOCX_SCRIPT = fileURLToPath(new URL('./pdf_to_docx.py', import.meta.url));
export const PDF_EXPORT_SCRIPT = fileURLToPath(new URL('./pdf_export.py', import.meta.url));
export const IMAGE_NORMALIZE_SCRIPT = fileURLToPath(new URL('./image_normalize.py', import.meta.url));
export const PDF_UTILITY_SCRIPT = fileURLToPath(new URL('./pdf_utility.py', import.meta.url));
export const PDF_SECURITY_SCRIPT = fileURLToPath(new URL('./pdf_security.py', import.meta.url));
export const PDF_REPAIR_SCRIPT = fileURLToPath(new URL('./pdf_repair.py', import.meta.url));
export const PDF_EDIT_SCRIPT = fileURLToPath(new URL('./pdf_edit.py', import.meta.url));
export const SEARCHABLE_PDF_SCRIPT = fileURLToPath(new URL('./searchable_pdf.py', import.meta.url));

export function pythonCanImport(modules: string[]): boolean {
  if (!PYTHON) return false;
  try {
    const code = modules.map((m) => `import ${m}`).join('; ');
    const res = spawnSync(PYTHON, ['-c', code], { timeout: 8000 });
    return !res.error && res.status === 0;
  } catch {
    return false;
  }
}

export const PY_PDF_TO_DOCX = pythonCanImport(['pdf2docx', 'fitz', 'docx']);
export const PY_PDF_EXPORT = pythonCanImport(['fitz', 'PIL', 'openpyxl', 'pptx']);
export const PY_IMAGE_NORMALIZE = pythonCanImport(['PIL']);
export const PY_PDF_UTILITY = pythonCanImport(['fitz']);
export const PY_PDF_SECURITY = pythonCanImport(['fitz']);
export const PDF_SECURITY_AVAILABLE = !!BIN.qpdf || !!(PYTHON && PY_PDF_SECURITY);
export const PY_PDF_REPAIR = pythonCanImport(['fitz']);
export const PDF_REPAIR_AVAILABLE = !!BIN.gs || !!BIN.qpdf || !!(PYTHON && PY_PDF_REPAIR);
export const PY_PDF_EDIT = pythonCanImport(['fitz']);
export const PY_SEARCHABLE_PDF = pythonCanImport(['fitz']);

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
