/** PDF lock, unlock, and permissions route registration. */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Hono } from 'hono';

import { makeWorkdir, run, saveUpload, sendFile } from './conversion-files';
import { BIN, PDF_SECURITY_SCRIPT, PYTHON, PY_PDF_SECURITY } from './runtime';

export function registerSecurityRoutes(app: Hono): void {
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
}
