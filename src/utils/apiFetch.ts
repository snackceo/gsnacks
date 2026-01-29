import { BACKEND_URL } from '../constants';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${BACKEND_URL}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const max429Retries = 3;
  for (let attempt = 0; attempt <= max429Retries; attempt++) {
    const res = await fetch(url, { ...options, headers, credentials: 'include' });

    if (res.status === 429) {
      // exponential-ish backoff: 500ms, 1000ms, 2000ms...
      const delay = 500 * Math.pow(2, attempt);
      await sleep(delay);
      continue;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    return data as T;
  }

  throw new Error('Too many requests (429) — giving up after retries');
}
