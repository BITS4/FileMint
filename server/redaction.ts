/** Destructive-redaction route registration. */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Hono } from 'hono';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { PDF_EDIT_SCRIPT, PYTHON, PY_PDF_EDIT } from './runtime';

export function registerRedactionRoute(app: Hono): void {
  app.post('/edit/redact', async (c) => {
    const dir = await makeWorkdir();
    try {
      if (!PYTHON || !PY_PDF_EDIT)
        throw new Error(
          'PDF redaction needs Python + PyMuPDF. Run: pip install -r server/requirements.lock.txt',
        );
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
}
