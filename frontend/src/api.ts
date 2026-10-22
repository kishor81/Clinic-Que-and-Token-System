import { useCallback, useEffect, useState } from 'react';

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Cannot reach the server'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
  return data as T;
}

export interface Queue {
  nowServing: { doctorId: string; token: string; name: string }[];
  waiting: { position: number; token: string; name: string; estimatedWaitMinutes: number }[];
}

/** Polls a GET endpoint. Keeps the previous data while refreshing (no flicker); `error` is set when a poll fails. */
export function usePoll<T>(path: string, ms = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api<T>(path)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [path]);
  useEffect(() => { load(); const t = setInterval(load, ms); return () => clearInterval(t); }, [load, ms]);
  return { data, error, loading: data === null && error === null, reload: load };
}
