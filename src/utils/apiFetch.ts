import { BACKEND_URL } from '../constants';

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export type ApiFetchError = Error & {
  status?: number;
  data?: any;
};

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${BACKEND_URL}${path}`;
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const max429Retries = 3;
  for (let attempt = 0; attempt <= max429Retries; attempt++) {
    // Ensure signal is not lost if present in options
    const { signal, ...rest } = options;
    const fetchOptions: RequestInit = {
      ...rest,
      headers,
      credentials: 'include',
      ...(signal ? { signal } : {})
    };
    const res = await fetch(url, fetchOptions);

    if (res.status === 429) {
      // exponential-ish backoff: 500ms, 1000ms, 2000ms...
      const delay = 500 * Math.pow(2, attempt);
      await sleep(delay);
      continue;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data?.error || `Request failed (${res.status})`) as ApiFetchError;
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data as T;
  }

  throw new Error('Too many requests (429) — giving up after retries');
}
