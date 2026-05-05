/**
 * Per-user column visibility + ordering for list views.
 *
 * Backed by /api/settings/view-prefs/{view_key}. Defaults live in the
 * per-view column registry (frontend/src/components/{documents,imaging}/columns.ts);
 * an absent server row means "use defaults".
 *
 * Falls back to legacy localStorage entries when the backend has nothing
 * stored, so existing local installs keep their setup.
 */

import { useEffect, useState, useCallback } from "react";
import api from "@/api/client";

export type ViewKey = "documents" | "imaging" | "lab";

export interface ColumnPref {
  visible: string[];
  order: string[];
}

/** Convenience hook: load + cache prefs for one view. The returned
 * ``setVisible`` / ``setOrder`` mutators PUT to the backend. */
export function useColumnPrefs(
  viewKey: ViewKey,
  defaults: { visible: string[]; order: string[] },
) {
  const [visible, setVisibleState] = useState<string[]>(defaults.visible);
  const [order, setOrderState] = useState<string[]>(defaults.order);
  const [loaded, setLoaded] = useState(false);

  // Initial load — prefer backend, fall back to localStorage (the
  // documents page used to keep its column setup there), fall back to
  // hard-coded defaults.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/settings/view-prefs/${viewKey}`);
        if (cancelled) return;
        const v = res.data?.visible;
        const o = res.data?.order;
        if (Array.isArray(v) && Array.isArray(o) && v.length > 0) {
          setVisibleState(v);
          setOrderState(o);
          setLoaded(true);
          return;
        }
      } catch {
        /* fall through to localStorage / defaults */
      }

      // Legacy localStorage migration — only for documents.
      if (viewKey === "documents") {
        try {
          const raw = localStorage.getItem("asclepius_documents_columns");
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr) && arr.length > 0) {
              setVisibleState(arr);
              setOrderState(defaults.order);
              setLoaded(true);
              // Push the legacy choice up to the server, then drop it
              // locally so a future device sees the synced value.
              try {
                await api.put(`/settings/view-prefs/${viewKey}`, {
                  visible: arr,
                  order: defaults.order,
                });
                localStorage.removeItem("asclepius_documents_columns");
              } catch {
                /* ignore — user can still browse */
              }
              return;
            }
          }
        } catch {
          /* fall through */
        }
      }
      setVisibleState(defaults.visible);
      setOrderState(defaults.order);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const persist = useCallback(
    async (v: string[], o: string[]) => {
      try {
        await api.put(`/settings/view-prefs/${viewKey}`, {
          visible: v,
          order: o,
        });
      } catch {
        /* swallow — UI keeps the optimistic update */
      }
    },
    [viewKey],
  );

  const setVisible = useCallback(
    (next: string[]) => {
      setVisibleState(next);
      persist(next, order);
    },
    [order, persist],
  );

  const setOrder = useCallback(
    (next: string[]) => {
      setOrderState(next);
      persist(visible, next);
    },
    [visible, persist],
  );

  return { visible, order, setVisible, setOrder, loaded };
}
