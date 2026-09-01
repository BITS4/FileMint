// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileItem } from '@/types';

import { useRunner } from './use-runner';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock('@/lib/haptics', () => mocks);

const file = (id: string): FileItem => ({
  id,
  name: `${id}.pdf`,
  kind: 'pdf',
  ext: 'pdf',
  size: 128,
  createdAt: 1,
  modifiedAt: 1,
  favorite: false,
  storageKey: id,
  source: 'created',
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useRunner', () => {
  it('publishes clamped progress and the successful result', async () => {
    const { result } = renderHook(() => useRunner());
    const output = file('converted');

    await act(async () => {
      await result.current.run(async (onProgress) => {
        onProgress(-0.25);
        onProgress(Number.NaN);
        onProgress(1.25);
        return output;
      });
    });

    expect(result.current).toMatchObject({
      state: 'done',
      progress: 1,
      error: undefined,
      result: output,
    });
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('exposes operation errors without retaining a previous result', async () => {
    const { result } = renderHook(() => useRunner());

    await act(async () => {
      await result.current.run(async () => file('previous'));
    });
    await act(async () => {
      await result.current.run(async () => {
        throw new Error('Conversion failed');
      });
    });

    expect(result.current).toMatchObject({
      state: 'error',
      progress: 0,
      error: 'Conversion failed',
      result: null,
    });
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  it('falls back to a safe message for non-Error rejections', async () => {
    const { result } = renderHook(() => useRunner());

    await act(async () => {
      await result.current.run(async () => Promise.reject('no details'));
    });

    expect(result.current.error).toBe('Something went wrong');
    expect(result.current.state).toBe('error');
  });

  it('invalidates an in-flight operation when reset', async () => {
    const pending = deferred<FileItem>();
    const { result } = renderHook(() => useRunner());
    let running!: Promise<void>;

    act(() => {
      running = result.current.run(() => pending.promise);
    });
    expect(result.current.state).toBe('running');

    act(() => result.current.reset());
    pending.resolve(file('stale'));
    await act(async () => running);

    expect(result.current).toMatchObject({
      state: 'idle',
      progress: 0,
      error: undefined,
      result: null,
    });
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('ignores an older run that reports progress and completes after the latest run', async () => {
    const older = deferred<FileItem>();
    const newer = deferred<FileItem>();
    const { result } = renderHook(() => useRunner());
    let reportOlderProgress!: (progress: number) => void;
    let olderRun!: Promise<void>;
    let newerRun!: Promise<void>;

    act(() => {
      olderRun = result.current.run((onProgress) => {
        reportOlderProgress = onProgress;
        return older.promise;
      });
    });
    act(() => {
      newerRun = result.current.run((onProgress) => {
        onProgress(0.4);
        return newer.promise;
      });
    });

    newer.resolve(file('latest'));
    await act(async () => newerRun);
    expect(result.current).toMatchObject({ state: 'done', progress: 0.4, result: file('latest') });

    act(() => reportOlderProgress(0.9));
    older.resolve(file('obsolete'));
    await act(async () => olderRun);

    expect(result.current).toMatchObject({ state: 'done', progress: 0.4, result: file('latest') });
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('ignores a stale rejection after a newer successful run', async () => {
    const older = deferred<FileItem>();
    const { result } = renderHook(() => useRunner());
    let olderRun!: Promise<void>;

    act(() => {
      olderRun = result.current.run(() => older.promise);
    });
    await act(async () => {
      await result.current.run(async () => file('latest'));
    });

    older.reject(new Error('obsolete failure'));
    await act(async () => olderRun);

    expect(result.current).toMatchObject({ state: 'done', error: undefined, result: file('latest') });
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
