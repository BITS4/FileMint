/**
 * Collabora Online integration via the WOPI protocol.
 *
 * FileMint stores files client-side, so to edit one we: upload its bytes here
 * (an "edit session"), let Collabora load/save it through the WOPI endpoints
 * below, then the client downloads the edited bytes back into its library.
 *
 * Networking (local dev with Docker Desktop):
 *   - browser  -> Collabora at  COLLABORA_URL   (default http://localhost:9980)
 *   - Collabora -> this server at WOPI_HOST      (default http://host.docker.internal:8787)
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import type { Hono } from 'hono';

interface EditSession {
  id: string;
  token: string;
  dir: string;
  filePath: string;
  fileName: string;
  ext: string;
  version: number;
  origin: string;
}

const sessions = new Map<string, EditSession>();

let discoveryCache: { url: string; byExt: Map<string, string>; fallback: string } | null = null;

async function loadDiscovery(collaboraUrl: string) {
  if (discoveryCache && discoveryCache.url === collaboraUrl) return discoveryCache;
  const res = await fetch(`${collaboraUrl}/hosting/discovery`);
  if (!res.ok) throw new Error(`Collabora discovery failed (${res.status})`);
  const xml = await res.text();
  const byExt = new Map<string, string>();
  let fallback = '';
  const actionRe = /<action\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = actionRe.exec(xml))) {
    const tag = m[0];
    const urlsrc = /\burlsrc="([^"]*)"/.exec(tag)?.[1];
    const ext = /\bext="([^"]*)"/.exec(tag)?.[1];
    if (!urlsrc) continue;
    if (!fallback) fallback = urlsrc;
    if (ext) byExt.set(ext.toLowerCase(), urlsrc);
  }
  discoveryCache = { url: collaboraUrl, byExt, fallback };
  return discoveryCache;
}

export async function detectCollabora(collaboraUrl: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${collaboraUrl}/hosting/discovery`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function registerEdit(app: Hono, opts: { collaboraUrl: string; wopiHost: string }) {
  const authed = (token: string | undefined, s: EditSession) => token === s.token;

  // ---- Upload a file to start an edit session.
  app.post('/edit/upload', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded.' }, 400);
    const origin = String(body['origin'] ?? '*');
    const id = randomUUID().replace(/-/g, '');
    const token = randomUUID().replace(/-/g, '');
    const dir = join(tmpdir(), `filemint-edit-${id}`);
    await mkdir(dir, { recursive: true });
    const fileName = (basename(file.name || 'document') || 'document').replace(/[^\w.\- ]+/g, '_');
    const filePath = join(dir, fileName);
    await writeFile(filePath, Buffer.from(await file.arrayBuffer()));
    sessions.set(id, { id, token, dir, filePath, fileName, ext: extname(fileName).slice(1).toLowerCase(), version: 1, origin });
    return c.json({ id, token, fileName });
  });

  // ---- Resolve the Collabora editor iframe URL for the session.
  app.get('/edit/url/:id', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.json({ error: 'Session not found.' }, 404);
    if (!authed(c.req.query('access_token'), s)) return c.json({ error: 'Unauthorized.' }, 401);
    try {
      const disc = await loadDiscovery(opts.collaboraUrl);
      const urlsrc = disc.byExt.get(s.ext) ?? disc.fallback;
      if (!urlsrc) throw new Error('No editor available for this file type.');
      const wopiSrc = `${opts.wopiHost}/wopi/files/${s.id}`;
      const sep = urlsrc.endsWith('?') ? '' : urlsrc.includes('?') ? '&' : '?';
      const url = `${urlsrc}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}&access_token=${s.token}&lang=en-US`;
      return c.json({ url });
    } catch (e) {
      const raw = e instanceof Error ? e.message : '';
      const unreachable = /failed|fetch|ECONNREFUSED|discovery|timed out/i.test(raw);
      const msg = unreachable
        ? `The Collabora editor isn't reachable at ${opts.collaboraUrl}. Start it in Docker (see the server README).`
        : raw || 'Editor unavailable.';
      return c.json({ error: msg }, 502);
    }
  });

  app.get('/edit/status/:id', (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.json({ error: 'Session not found.' }, 404);
    if (!authed(c.req.query('access_token'), s)) return c.json({ error: 'Unauthorized.' }, 401);
    return c.json({ version: s.version });
  });

  app.get('/edit/download/:id', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.text('Session not found.', 404);
    if (!authed(c.req.query('access_token'), s)) return c.text('Unauthorized.', 401);
    const bytes = await readFile(s.filePath);
    return c.body(new Uint8Array(bytes), 200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${s.fileName}"`,
    });
  });

  app.post('/edit/close/:id', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (s && authed(c.req.query('access_token'), s)) {
      await rm(s.dir, { recursive: true, force: true }).catch(() => undefined);
      sessions.delete(s.id);
    }
    return c.json({ ok: true });
  });

  // ---- WOPI host endpoints (called by Collabora) -------------------------
  app.get('/wopi/files/:id', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.json({ error: 'not found' }, 404);
    if (!authed(c.req.query('access_token'), s)) return c.json({ error: 'unauthorized' }, 401);
    const bytes = await readFile(s.filePath);
    return c.json({
      BaseFileName: s.fileName,
      Size: bytes.length,
      OwnerId: 'filemint',
      UserId: 'filemint-user',
      UserFriendlyName: 'FileMint User',
      UserCanWrite: true,
      ReadOnly: false,
      SupportsUpdate: true,
      SupportsLocks: false,
      UserCanNotWriteRelative: true,
      Version: `v${s.version}`,
      LastModifiedTime: new Date().toISOString(),
      PostMessageOrigin: s.origin,
      EnableOwnerTermination: true,
      EditModePostMessage: true,
      EditNotificationPostMessage: true,
      ClosePostMessage: true,
    });
  });

  app.get('/wopi/files/:id/contents', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.text('not found', 404);
    if (!authed(c.req.query('access_token'), s)) return c.text('unauthorized', 401);
    const bytes = await readFile(s.filePath);
    return c.body(new Uint8Array(bytes), 200, { 'Content-Type': 'application/octet-stream' });
  });

  app.post('/wopi/files/:id/contents', async (c) => {
    const s = sessions.get(c.req.param('id'));
    if (!s) return c.text('not found', 404);
    if (!authed(c.req.query('access_token'), s)) return c.text('unauthorized', 401);
    const buf = Buffer.from(await c.req.arrayBuffer());
    await writeFile(s.filePath, buf);
    s.version += 1;
    return c.json({ LastModifiedTime: new Date().toISOString() });
  });
}
