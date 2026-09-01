import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectCollabora, getLastCollaboraProbe, registerEdit } from './edit';

function editApp(
  collaboraUrl = 'https://collabora.example.com',
  wopiHost = 'https://files.example.com',
  lifecycle: { sessionTtlMs?: number; maxSessions?: number } = {},
) {
  const app = new Hono();
  registerEdit(app, { collaboraUrl, wopiHost, ...lifecycle });
  return app;
}

async function upload(
  app: Hono,
  name = 'draft.docx',
  contents = 'version one',
  origin = 'https://app.example.com',
) {
  const form = new FormData();
  form.append('file', new File([contents], name, { type: 'application/octet-stream' }));
  form.append('origin', origin);
  const response = await app.request('/edit/upload', { method: 'POST', body: form });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string; token: string; fileName: string };
}

describe('Collabora edit sessions', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('rejects upload requests without a file', async () => {
    const response = await editApp().request('/edit/upload', {
      method: 'POST',
      body: new FormData(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No file uploaded.' });
  });

  it('supports the authenticated WOPI read, update, download, and close lifecycle', async () => {
    const app = editApp();
    const session = await upload(app, 'draft<script>.docx');
    expect(session.fileName).toBe('draft_script_.docx');

    const unauthorized = await app.request(`/edit/status/${session.id}?access_token=wrong`);
    expect(unauthorized.status).toBe(401);

    const initialStatus = await app.request(`/edit/status/${session.id}?access_token=${session.token}`);
    expect(await initialStatus.json()).toEqual({ version: 1 });

    const metadata = await app.request(`/wopi/files/${session.id}?access_token=${session.token}`);
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      BaseFileName: 'draft_script_.docx',
      Size: 11,
      UserCanWrite: true,
      Version: 'v1',
      PostMessageOrigin: 'https://app.example.com',
    });

    const initialContents = await app.request(
      `/wopi/files/${session.id}/contents?access_token=${session.token}`,
    );
    expect(await initialContents.text()).toBe('version one');

    const update = await app.request(`/wopi/files/${session.id}/contents?access_token=${session.token}`, {
      method: 'POST',
      body: new TextEncoder().encode('version two'),
    });
    expect(update.status).toBe(200);
    expect(await update.json()).toHaveProperty('LastModifiedTime');

    const updatedStatus = await app.request(`/edit/status/${session.id}?access_token=${session.token}`);
    expect(await updatedStatus.json()).toEqual({ version: 2 });

    const download = await app.request(`/edit/download/${session.id}?access_token=${session.token}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="draft_script_.docx"');
    expect(await download.text()).toBe('version two');

    const ignoredClose = await app.request(`/edit/close/${session.id}?access_token=wrong`, {
      method: 'POST',
    });
    expect(await ignoredClose.json()).toEqual({ ok: true });
    expect((await app.request(`/edit/status/${session.id}?access_token=${session.token}`)).status).toBe(200);

    await app.request(`/edit/close/${session.id}?access_token=${session.token}`, { method: 'POST' });
    expect((await app.request(`/edit/status/${session.id}?access_token=${session.token}`)).status).toBe(404);
  });

  it('expires tokens at the server boundary and removes their temporary files', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const app = editApp(undefined, undefined, { sessionTtlMs: 1000 });
    const session = await upload(app, 'expires.docx');
    const sessionDir = join(tmpdir(), `filemint-edit-${session.id}`);
    await expect(access(sessionDir)).resolves.toBeUndefined();

    vi.setSystemTime(new Date('2026-09-01T12:00:01.001Z'));
    const expired = await app.request(`/wopi/files/${session.id}?access_token=${session.token}`);

    expect(expired.status).toBe(404);
    expect(await expired.json()).toEqual({ error: 'not found' });
    expect((await app.request(`/edit/status/${session.id}?access_token=${session.token}`)).status).toBe(404);
    await expect(access(sessionDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('automatically removes abandoned sessions when their deadline passes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'));
    const app = editApp(undefined, undefined, { sessionTtlMs: 250 });
    const session = await upload(app, 'abandoned.docx');

    await vi.advanceTimersByTimeAsync(251);

    expect((await app.request(`/edit/status/${session.id}?access_token=${session.token}`)).status).toBe(404);
  });

  it('bounds the registry and cleans up the oldest session on overflow', async () => {
    const app = editApp(undefined, undefined, { maxSessions: 2 });
    const oldest = await upload(app, 'oldest.docx');
    const middle = await upload(app, 'middle.docx');
    const newest = await upload(app, 'newest.docx');

    expect((await app.request(`/edit/status/${oldest.id}?access_token=${oldest.token}`)).status).toBe(404);
    expect((await app.request(`/edit/status/${middle.id}?access_token=${middle.token}`)).status).toBe(200);
    expect((await app.request(`/edit/status/${newest.id}?access_token=${newest.token}`)).status).toBe(200);
    await expect(access(join(tmpdir(), `filemint-edit-${oldest.id}`))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await app.request(`/edit/close/${middle.id}?access_token=${middle.token}`, { method: 'POST' });
    await app.request(`/edit/close/${newest.id}?access_token=${newest.token}`, { method: 'POST' });
  });

  it('chooses the edit discovery action and reports an allowed frame policy', async () => {
    const ttlMs = 60_000;
    const startedAt = Date.now();
    const app = editApp(undefined, undefined, { sessionTtlMs: ttlMs });
    const session = await upload(app);
    const discovery = [
      '<wopi-discovery>',
      '<action ext="docx" name="view" default="true" urlsrc="https://collabora.example.com/view?"/>',
      '<action ext="docx" name="edit" urlsrc="https://collabora.example.com/edit?"/>',
      '</wopi-discovery>',
    ].join('');
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { 'content-security-policy': 'frame-ancestors https://app.example.com' },
        });
      }
      return new Response(discovery, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await app.request(`/edit/url/${session.id}?access_token=${session.token}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      url: string;
      wopiHost: string;
      frameAllowed: boolean;
      framePolicy?: string;
    };
    expect(body.wopiHost).toBe('https://files.example.com');
    expect(body.url).toContain('https://collabora.example.com/edit?WOPISrc=');
    expect(body.url).toContain(`access_token=${session.token}`);
    const tokenTtl = Number(new URL(body.url).searchParams.get('access_token_ttl'));
    expect(tokenTtl).toBeGreaterThanOrEqual(startedAt + ttlMs);
    expect(tokenTtl).toBeLessThanOrEqual(Date.now() + ttlMs);
    expect(body.frameAllowed).toBe(true);
    expect(body.framePolicy).toContain('frame-ancestors');

    await app.request(`/edit/close/${session.id}?access_token=${session.token}`, { method: 'POST' });
  });

  it('records the latest Collabora discovery probe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<wopi-discovery></wopi-discovery>', { status: 200 })),
    );

    await expect(detectCollabora('https://probe.example.com')).resolves.toBe(true);
    expect(getLastCollaboraProbe()).toMatchObject({
      online: true,
      status: 200,
      url: 'https://probe.example.com/hosting/discovery',
    });
  });

  it('rejects missing or unauthorized WOPI resources without leaking file data', async () => {
    const app = editApp();
    const session = await upload(app, 'private.docx');

    expect((await app.request('/edit/download/missing?access_token=x')).status).toBe(404);
    expect((await app.request(`/edit/download/${session.id}?access_token=wrong`)).status).toBe(401);
    expect((await app.request('/wopi/files/missing?access_token=x')).status).toBe(404);
    expect((await app.request(`/wopi/files/${session.id}?access_token=wrong`)).status).toBe(401);
    expect((await app.request('/wopi/files/missing/contents?access_token=x')).status).toBe(404);
    expect((await app.request(`/wopi/files/${session.id}/contents?access_token=wrong`)).status).toBe(401);
    expect(
      (
        await app.request('/wopi/files/missing/contents?access_token=x', {
          method: 'POST',
          body: 'blocked',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/wopi/files/${session.id}/contents?access_token=wrong`, {
          method: 'POST',
          body: 'blocked',
        })
      ).status,
    ).toBe(401);

    await app.request(`/edit/close/${session.id}?access_token=${session.token}`, { method: 'POST' });
  });

  it('handles restrictive, wildcard, absent, and failed frame-policy probes', async () => {
    const scenarios = [
      { policy: "frame-ancestors 'none'", expected: false },
      { policy: 'frame-ancestors *', expected: true },
      { policy: null, expected: true },
      { policy: 'frame-ancestors https://different.example.com', expected: false },
    ];

    for (const [index, scenario] of scenarios.entries()) {
      const collaboraUrl = `https://collabora-${index}.example.com`;
      const app = editApp(collaboraUrl);
      const session = await upload(app, `draft-${index}.docx`, 'draft', 'not a valid origin');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
          if (init?.method === 'HEAD') {
            return new Response(null, {
              status: 200,
              headers: scenario.policy ? { 'content-security-policy': scenario.policy } : undefined,
            });
          }
          return new Response(
            `<wopi-discovery><action ext="docx" name="edit" urlsrc="${collaboraUrl}/edit"/></wopi-discovery>`,
            { status: 200 },
          );
        }),
      );

      const response = await app.request(`/edit/url/${session.id}?access_token=${session.token}`);
      expect((await response.json()) as { frameAllowed: boolean }).toMatchObject({
        frameAllowed: scenario.expected,
      });
      await app.request(`/edit/close/${session.id}?access_token=${session.token}`, { method: 'POST' });
    }

    const app = editApp('https://collabora-head-error.example.com');
    const session = await upload(app);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === 'HEAD') throw new Error('HEAD blocked');
        return new Response(
          '<wopi-discovery><action ext="docx" name="edit" urlsrc="https://collabora.example.com/edit?mode=edit"/></wopi-discovery>',
          { status: 200 },
        );
      }),
    );
    const response = await app.request(
      `https://public-request.example.com/edit/url/${session.id}?access_token=${session.token}`,
    );
    expect(await response.json()).toMatchObject({
      wopiHost: 'https://public-request.example.com',
      frameAllowed: true,
      frameError: 'HEAD blocked',
    });
    await app.request(`/edit/close/${session.id}?access_token=${session.token}`, { method: 'POST' });
  });

  it('returns clear errors for missing discovery actions and failed discovery probes', async () => {
    const noActionApp = editApp('https://no-actions.example.com');
    const noActionSession = await upload(noActionApp);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<wopi-discovery></wopi-discovery>', { status: 200 })),
    );
    const noAction = await noActionApp.request(
      `/edit/url/${noActionSession.id}?access_token=${noActionSession.token}`,
    );
    expect(noAction.status).toBe(502);
    expect(await noAction.json()).toEqual({ error: 'No editor available for this file type.' });
    await noActionApp.request(`/edit/close/${noActionSession.id}?access_token=${noActionSession.token}`, {
      method: 'POST',
    });

    vi.stubEnv('COLLABORA_DETECT_TIMEOUT_MS', '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection failed');
      }),
    );
    await expect(detectCollabora('https://offline.example.com')).resolves.toBe(false);
    expect(getLastCollaboraProbe()).toMatchObject({ online: false, error: 'connection failed' });
  });
});
