/** Temporary-file and child-process utilities for conversion routes. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BIN } from './runtime';

const DEFAULT_MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;

function maxProcessOutputBytes(): number {
  const configured = Number(process.env.FILEMINT_MAX_PROCESS_OUTPUT_BYTES);
  if (!Number.isSafeInteger(configured) || configured < 1024 || configured > 16 * 1024 * 1024) {
    return DEFAULT_MAX_PROCESS_OUTPUT_BYTES;
  }
  return configured;
}

// ------------------------------------------------------------------- utils
export function run(
  cmd: string,
  args: string[],
  timeout = 180000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { timeout, windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const outputLimit = maxProcessOutputBytes();
    let outputBytes = 0;
    let settled = false;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      proc.kill('SIGKILL');
      reject(error);
    };
    const capture = (target: Buffer[], chunk: unknown) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      outputBytes += bytes.length;
      if (outputBytes > outputLimit) {
        fail(new Error('Conversion process output exceeded the configured safety limit.'));
        return;
      }
      target.push(bytes);
    };

    proc.stdout?.on('data', (chunk) => capture(stdout, chunk));
    proc.stderr?.on('data', (chunk) => capture(stderr, chunk));
    proc.on('error', fail);
    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        code: code ?? (signal ? 124 : 0),
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      });
    });
  });
}

export async function makeWorkdir(): Promise<string> {
  const dir = join(tmpdir(), `filemint-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export const MIME: Record<string, string> = {
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

export interface Upload {
  path: string;
  name: string;
}

export async function saveUpload(dir: string, file: unknown): Promise<Upload> {
  if (!(file instanceof File)) throw new Error('No file uploaded under field "file".');
  const safeName = basename(file.name || 'input').replace(/[^\w.\- ]+/g, '_');
  const path = join(dir, safeName || 'input');
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  return { path, name: safeName };
}

/** Send a produced file then delete the working directory. */
export async function sendFile(
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

export async function libreConvert(dir: string, input: Upload, targetExt: string): Promise<string> {
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
