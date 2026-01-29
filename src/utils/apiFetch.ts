import { BACKEND_URL } from '../constants';

export const apiFetch = (path: string, options: RequestInit = {}) => {
  const url = path.startsWith('http') ? path : `${BACKEND_URL}${path}`;
  return fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.headers ?? {})
    }
  });
};
