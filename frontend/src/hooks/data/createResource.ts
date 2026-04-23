import { useEffect, useState } from "react";
import api from "@/api/client";

/**
 * Create a shared, lazily-fetched, per-URL in-memory cache hook.
 *
 * Multiple components calling the same hook across pages share one network
 * request; the cache is invalidated explicitly via `refetch()`. No React
 * Query on purpose — the data sets here (known doctors / facilities /
 * specialties / patients) are small and rarely change mid-session, so a
 * minimal cache is plenty.
 */
export function createResource<T>(path: string) {
  let data: T | undefined;
  let inflight: Promise<void> | null = null;
  let error: unknown = null;
  const subs = new Set<() => void>();

  function notify() {
    subs.forEach((fn) => fn());
  }

  function load() {
    if (inflight) return inflight;
    inflight = api
      .get(path)
      .then((r) => {
        data = r.data as T;
        error = null;
      })
      .catch((e) => {
        error = e;
      })
      .finally(() => {
        inflight = null;
        notify();
      });
    return inflight;
  }

  function invalidate() {
    data = undefined;
    error = null;
    load();
  }

  return function useResource() {
    const [, setTick] = useState(0);
    useEffect(() => {
      const fn = () => setTick((t) => t + 1);
      subs.add(fn);
      if (data === undefined && !inflight) load();
      return () => {
        subs.delete(fn);
      };
    }, []);
    return {
      data,
      loading: !!inflight,
      error,
      refetch: invalidate,
    };
  };
}
