'use client';

import { useCallback, useState } from 'react';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface FetchMutationConfig {
  url: string;
  method: HttpMethod;
  body?: Record<string, unknown> | FormData;
  headers?: Record<string, string>;
}

export interface FetchMutationResult<TData = unknown> {
  /** Execute the request. Returns parsed JSON on success, or null on error. */
  execute: <T = TData>(config: FetchMutationConfig) => Promise<{ data: T } | null>;
  loading: boolean;
  error: string | null;
  data: TData | null;
  /** Clear error and data. */
  reset: () => void;
}

const DEFAULT_ERROR = 'Request failed';

/**
 * Reusable hook for fetch mutations (POST, PUT, PATCH, DELETE).
 * Handles loading state, error from response body, and optional JSON body or FormData.
 */
export function useFetchMutation<TData = unknown>(): FetchMutationResult<TData> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TData | null>(null);

  const execute = useCallback(
    async <T = TData>(config: FetchMutationConfig): Promise<{ data: T } | null> => {
      const { url, method, body, headers: customHeaders = {} } = config;
      setError(null);
      setLoading(true);
      try {
        const init: RequestInit = { method };
        if (body !== undefined && body !== null && method !== 'GET') {
          if (body instanceof FormData) {
            init.body = body;
            // Do not set Content-Type for FormData; browser sets it with boundary
          } else {
            init.body = JSON.stringify(body);
            customHeaders['Content-Type'] = customHeaders['Content-Type'] ?? 'application/json';
          }
        }
        if (Object.keys(customHeaders).length > 0) {
          init.headers = customHeaders;
        }
        const res = await fetch(url, init);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const message = json?.error?.message ?? DEFAULT_ERROR;
          setError(message);
          setLoading(false);
          return null;
        }
        setData(json as TData);
        setLoading(false);
        return { data: json as T };
      } catch {
        setError(DEFAULT_ERROR);
        setLoading(false);
        return null;
      }
    },
    []
  );

  const reset = useCallback((): void => {
    setError(null);
    setData(null);
  }, []);

  return { execute, loading, error, data, reset };
}
