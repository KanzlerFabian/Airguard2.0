import { useEffect, useMemo, useState } from 'react';
import type { EvalResponse } from '../types/eval';

type FetchState =
  | { status: 'idle' | 'loading'; data: EvalResponse | null; error: null }
  | { status: 'success'; data: EvalResponse; error: null }
  | { status: 'error'; data: EvalResponse | null; error: Error };

const REFRESH_INTERVAL = 30000;

export function useAiEval() {
  const [state, setState] = useState<FetchState>({ status: 'idle', data: null, error: null });

  useEffect(() => {
    let isMounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      if (!isMounted) return;
      setState((prev) => ({ status: 'loading', data: prev.data ?? null, error: null }));
      try {
        const response = await fetch('/ai/eval', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }
        const json = (await response.json()) as EvalResponse;
        if (!isMounted) return;
        setState({ status: 'success', data: json, error: null });
      } catch (error) {
        if (!isMounted) return;
        setState((prev) => ({ status: 'error', data: prev.data, error: error as Error }));
      } finally {
        if (isMounted) {
          timer = setTimeout(load, REFRESH_INTERVAL);
        }
      }
    };

    load();

    return () => {
      isMounted = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  const offline = useMemo(() => state.status === 'error', [state.status]);

  return { ...state, offline };
}
