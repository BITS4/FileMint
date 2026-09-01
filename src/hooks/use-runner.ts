import { useCallback, useEffect, useRef, useState } from 'react';

import * as haptics from '@/lib/haptics';
import type { FileItem } from '@/types';

export type RunState = 'idle' | 'running' | 'done' | 'error';
export type RunResult = FileItem | FileItem[];

export interface Runner {
  state: RunState;
  progress: number;
  error?: string;
  result: RunResult | null;
  run: (fn: (onProgress: (p: number) => void) => Promise<RunResult>) => Promise<void>;
  reset: () => void;
}

/** Wraps an async tool operation with progress, error and result state. */
export function useRunner(): Runner {
  const [state, setState] = useState<RunState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<RunResult | null>(null);
  const runSequence = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runSequence.current += 1;
    };
  }, []);

  const run = useCallback(async (fn: (onProgress: (p: number) => void) => Promise<RunResult>) => {
    const runId = ++runSequence.current;
    const isCurrent = () => mounted.current && runSequence.current === runId;

    setState('running');
    setProgress(0);
    setError(undefined);
    setResult(null);
    try {
      const r = await fn((p) => {
        if (isCurrent() && Number.isFinite(p)) {
          setProgress(Math.max(0, Math.min(1, p)));
        }
      });
      if (!isCurrent()) return;
      setResult(r);
      setState('done');
      haptics.success();
    } catch (e) {
      if (!isCurrent()) return;
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setState('error');
      haptics.error();
    }
  }, []);

  const reset = useCallback(() => {
    runSequence.current += 1;
    setState('idle');
    setProgress(0);
    setError(undefined);
    setResult(null);
  }, []);

  return { state, progress, error, result, run, reset };
}
