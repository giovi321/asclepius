import { useEffect, useState } from "react";
import api from "@/api/client";
import type { MedicalEvent } from "@/types";

// Parameter-keyed cache for /events. Each (patientId, eventType) pair gets
// its own cache entry — switching patients shouldn't refetch previously-seen
// patients and shouldn't leak events between them.
type Entry = {
  data: MedicalEvent[] | undefined;
  inflight: Promise<void> | null;
  error: unknown;
  subs: Set<() => void>;
};

const cache = new Map<string, Entry>();

const cacheKey = (patientId?: number | null, eventType?: string | null) =>
  `${patientId ?? ""}:${eventType ?? ""}`;

function getEntry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { data: undefined, inflight: null, error: null, subs: new Set() };
    cache.set(key, e);
  }
  return e;
}

function load(
  key: string,
  patientId?: number | null,
  eventType?: string | null,
) {
  const e = getEntry(key);
  if (e.inflight) return e.inflight;
  const params: Record<string, any> = {};
  if (patientId) params.patient_id = patientId;
  if (eventType) params.event_type = eventType;
  e.inflight = api
    .get("/events", { params })
    .then((r) => {
      e!.data = r.data as MedicalEvent[];
      e!.error = null;
    })
    .catch((err) => {
      e!.error = err;
    })
    .finally(() => {
      e!.inflight = null;
      e!.subs.forEach((fn) => fn());
    });
  return e.inflight;
}

export interface UseEventsOpts {
  patientId?: number | null;
  eventType?: string | null;
  /** Skip the fetch entirely — useful before the patient is known. */
  enabled?: boolean;
}

export function useEvents(opts: UseEventsOpts = {}) {
  const { patientId, eventType, enabled = true } = opts;
  const key = cacheKey(patientId, eventType);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const entry = getEntry(key);
    const fn = () => setTick((t) => t + 1);
    entry.subs.add(fn);
    if (entry.data === undefined && !entry.inflight) {
      load(key, patientId, eventType);
    }
    return () => {
      entry.subs.delete(fn);
    };
  }, [key, enabled, patientId, eventType]);

  const entry = getEntry(key);
  return {
    data: enabled ? entry.data : undefined,
    loading: enabled ? !!entry.inflight : false,
    error: enabled ? entry.error : null,
    refetch: () => {
      const e = getEntry(key);
      e.data = undefined;
      e.error = null;
      return load(key, patientId, eventType);
    },
  };
}
