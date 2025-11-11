import { useEffect, useRef, useState } from 'react';
import type { EventMessage } from './types';

const resolveGatewayBaseUrl = () => {
  if (import.meta.env.VITE_GATEWAY_URL) {
    return import.meta.env.VITE_GATEWAY_URL as string;
  }
  if (typeof globalThis !== 'undefined' && globalThis.window) {
    return globalThis.window.location.origin;
  }
  return 'http://localhost:8080';
};

export type StreamStatus = 'connecting' | 'open' | 'error';

export const useEventStream = <T = EventMessage>(endpoint: string, limit = 50) => {
  const [events, setEvents] = useState<T[]>([]);
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const baseUrl = resolveGatewayBaseUrl();

    const connect = () => {
      if (stopped) return;
      setStatus('connecting');
      const url = new URL(endpoint, baseUrl);
      const source = new EventSource(url);
      eventSourceRef.current = source;

      source.onopen = () => {
        attempts = 0;
        setStatus('open');
      };

      source.onmessage = (evt) => {
        try {
          const payload = JSON.parse(evt.data);
          setEvents((prev) => {
            const next = [payload as T, ...prev];
            return next.slice(0, limit);
          });
        } catch (error) {
          console.error('Failed to parse event payload', error);
        }
      };

      source.onerror = (err) => {
        console.error('SSE error', err);
        setStatus('error');
        source.close();
        if (!stopped) {
          const delay = Math.min(15_000, 1000 * 2 ** attempts);
          attempts += 1;
          retryTimer = setTimeout(connect, delay);
        }
      };
    };

    connect();

    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      eventSourceRef.current?.close();
    };
  }, [endpoint, limit]);

  return { events, status } as const;
};

export const usePolling = <T,>(path: string, intervalMs = 5000) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    const baseUrl = resolveGatewayBaseUrl();
    const fetchData = async () => {
      try {
        const url = new URL(path, baseUrl);
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const json = (await res.json()) as T;
        if (mounted) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      }
    };

    void fetchData();
    const id = setInterval(fetchData, intervalMs);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [path, intervalMs]);

  return { data, error } as const;
};
