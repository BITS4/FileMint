import { useCallback, useState } from 'react';

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

  const run = useCallback(async (fn: (onProgress: (p: number) => void) => Promise<RunResult>) => {
    setState('running');
    setProgress(0);
    setError(undefined);
    try {
      const r = await fn((p) => setProgress(Math.max(0, Math.min(1, p))));
      setResult(r);
      setState('done');
      haptics.success();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setState('error');
      haptics.error();
    }
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress(0);
    setError(undefined);
    setResult(null);
  }, []);

  return { state, progress, error, result, run, reset };
}
