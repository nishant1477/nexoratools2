'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { Limits } from './types';

let limitsCache: Limits | null = null;
/** Upload size limit and retention window, as configured on the server. */
export function useLimits(): Limits | null {
  const [limits, setLimits] = useState<Limits | null>(limitsCache);
  useEffect(() => {
    if (limitsCache) return;
    api<{ limits: Limits }>('/tools').then((d) => { limitsCache = d.limits; setLimits(d.limits); }).catch(() => undefined);
  }, []);
  return limits;
}

/** Load data from the API with loading/error state and manual reload. Re-runs when `key` changes. */
export function useApi<T>(path: string | null, key: unknown = path, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(path !== null);
  const seq = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (path === null) return;
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    try { const d = await api<T>(path); if (mine === seq.current) { setData(d); setError(''); } }
    catch (err) { if (mine === seq.current) setError(errorMessage(err)); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [path]);

  useEffect(() => { void load(); }, [key, load]);
  useEffect(() => { if (!pollMs) return; const t = setInterval(() => void load(true), pollMs); return () => clearInterval(t); }, [pollMs, load]);
  return { data, error, loading, reload: () => load(), setData };
}
