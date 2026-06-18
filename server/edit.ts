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

interface DiscoveryAction {
  urlsrc: string;
  name: string;
  isDefault: boolean;
}

interface FramePolicyProbe {
  allowed: boolean;
  policy?: string;
  error?: string;
}

let discoveryCache: { url: string; byExt: Map<string, DiscoveryAction>; fallback: string } | null = null;

export interface CollaboraProbe {
  online: boolean;
  url: string;
  status?: number;
  error?: string;
  durationMs: number;
  checkedAt: string;
}

let lastCollaboraProbe: CollaboraProbe | null = null;

export function getLastCollaboraProbe(): CollaboraProbe | null {
  return lastCollaboraProbe;
}

function discoveryUrl(collaboraUrl: string): string {
  return new URL('hosting/discovery', `${collaboraUrl.replace(/\/+$/, '')}/`).toString();
}

async function loadDiscovery(collaboraUrl: string) {
  if (discoveryCache && discoveryCache.url === collaboraUrl) return discoveryCache;
  const res = await fetch(discoveryUrl(collaboraUrl));
  if (!res.ok) throw new Error(`Collabora discovery failed (${res.status})`);
  const xml = await res.text();
  const byExt = new Map<string, DiscoveryAction>();
  let fallback = '';
  const actionRe = /<action\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = actionRe.exec(xml))) {
    const tag = m[0];
    const urlsrc = /\burlsrc="([^"]*)"/.exec(tag)?.[1];
    const ext = /\bext="([^"]*)"/.exec(tag)?.[1];
    const name = /\bname="([^"]*)"/.exec(tag)?.[1]?.toLowerCase() ?? '';
    const isDefault = /\bdefault="true"/i.test(tag);
    if (!urlsrc) continue;
    if (!fallback) fallback = urlsrc;
    if (ext) {
      const key = ext.toLowerCase();
      const current = byExt.get(key);
      if (!current || name === 'edit' || (isDefault && current.name !== 'edit')) {
        byExt.set(key, { urlsrc, name, isDefault });
      }
    }
  }
  discoveryCache = { url: collaboraUrl, byExt, fallback };
  return discoveryCache;
}

function isPrivateLanHost(hostname: string): boolean {
  return /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname.endsWith('.local');
}

function publicHttpsOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (
      !url.hostname ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === 'host.docker.internal' ||
      isPrivateLanHost(url.hostname)
    ) {
      return null;
    }
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function hostedWopiHostForSession(fallback: string, requestOrigin: string): string {
  return publicHttpsOrigin(requestOrigin) ?? publicHttpsOrigin(fallback) ?? fallback;
}

function framePolicyAllowsOrigin(policy: string | null, origin: string): boolean {
  if (!policy) return true;
  const frameAncestors = /(?:^|;)\s*frame-ancestors\s+([^;]+)/i.exec(policy)?.[1]?.toLowerCase();
  if (!frameAncestors) return true;
  if (frameAncestors.includes("'none'")) return false;
  if (frameAncestors.includes('*')) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    const originText = `${url.protocol}//${host}`.toLowerCase();
    return frameAncestors
      .split(/\s+/)
      .some((source) => source.includes(originText) || source.includes(`${host}:`) || source === host);
  } catch {
    return false;
  }
}

async function probeFramePolicy(url: string, origin: string): Promise<FramePolicyProbe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4500);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal });
    const policy = res.headers.get('content-security-policy') ?? undefined;
    return { allowed: framePolicyAllowsOrigin(policy ?? null, origin), policy };
  } catch (e) {
    return { allowed: true, error: e instanceof Error ? e.message : 'Could not check frame policy.' };
  } finally {
    clearTimeout(timer);
  }
}

export async function detectCollabora(collaboraUrl: string): Promise<boolean> {
  const started = Date.now();
  const url = discoveryUrl(collaboraUrl);
  const checkedAt = new Date().toISOString();
  const timeoutMs = Math.max(4000, Number(process.env.COLLABORA_DETECT_TIMEOUT_MS ?? 15000) || 15000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const xml = await res.text();
    const online = res.ok && /<wopi-discovery\b/i.test(xml);
    lastCollaboraProbe = {
      online,
      url,
      status: res.status,
      error: online ? undefined : `Discovery response did not look like WOPI XML (${res.status}).`,
      durationMs: Date.now() - started,
      checkedAt,
    };
    return online;
  } catch (e) {
    lastCollaboraProbe = {
      online: false,
      url,
      error: e instanceof Error ? e.message : 'Collabora discovery failed.',
      durationMs: Date.now() - started,
      checkedAt,
    };
    return false;
  } finally {
    clearTimeout(timer);
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
      const urlsrc = disc.byExt.get(s.ext)?.urlsrc ?? disc.fallback;
      if (!urlsrc) throw new Error('No editor available for this file type.');
      const requestOrigin = new URL(c.req.url).origin;
      const wopiHost = hostedWopiHostForSession(opts.wopiHost, requestOrigin);
      const wopiSrc = `${wopiHost}/wopi/files/${s.id}`;
      const sep = urlsrc.endsWith('?') ? '' : urlsrc.includes('?') ? '&' : '?';
      const url = `${urlsrc}${sep}WOPISrc=${encodeURIComponent(wopiSrc)}&access_token=${s.token}&access_token_ttl=0&lang=en-US`;
      const frame = await probeFramePolicy(url, s.origin);
      return c.json({
        url,
        wopiHost,
        frameAllowed: frame.allowed,
        framePolicy: frame.policy,
        frameError: frame.error,
      });
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
      SupportsGetLock: false,
      SupportsExtendedLockLength: false,
      SupportsUserInfo: false,
      SupportsRename: false,
      SupportsDeleteFile: false,
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
