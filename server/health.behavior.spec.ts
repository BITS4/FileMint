import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectCollabora, getLastCollaboraProbe } from './edit';
import { registerHealthRoute } from './health';

vi.mock('./edit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./edit')>();
  return {
    ...actual,
    detectCollabora: vi.fn(),
    getLastCollaboraProbe: vi.fn(),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(detectCollabora).mockResolvedValue(false);
  vi.mocked(getLastCollaboraProbe).mockReturnValue(null);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('health Collabora refresh behavior', () => {
  it('publishes refreshed online state with a fallback service probe', async () => {
    vi.mocked(detectCollabora).mockResolvedValueOnce(true);
    const app = new Hono();
    registerHealthRoute(app);
    await Promise.resolve();
    await Promise.resolve();

    const response = await app.request('/health');
    const body = await response.json();
    expect(body.capabilities.collabora).toBe(true);
    expect(body.services.collabora).toMatchObject({ online: true, checkedAt: null });
  });

  it('does not overlap refreshes while the previous probe remains pending', async () => {
    const probe = deferred<boolean>();
    vi.mocked(detectCollabora).mockReturnValueOnce(probe.promise).mockResolvedValueOnce(false);
    const app = new Hono();
    registerHealthRoute(app);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(detectCollabora).toHaveBeenCalledTimes(1);
    probe.resolve(true);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(detectCollabora).toHaveBeenCalledTimes(2);
  });

  it('keeps health responsive after probe rejection and exposes a recorded probe', async () => {
    vi.mocked(detectCollabora).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(getLastCollaboraProbe).mockReturnValue({
      online: false,
      url: 'http://collabora.test',
      checkedAt: '2026-09-01T00:00:00.000Z',
      error: 'offline',
    });
    const app = new Hono();
    registerHealthRoute(app);
    await Promise.resolve();
    await Promise.resolve();

    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect((await response.json()).services.collabora).toMatchObject({
      online: false,
      error: 'offline',
    });
  });
});
