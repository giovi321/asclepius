import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import api from "@/api/client";
import type { PipelineStatus } from "@/types";

interface PipelineStatusCtx {
  status: PipelineStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ctx = createContext<PipelineStatusCtx>({
  status: null,
  loading: false,
  refresh: async () => {},
});

const POLL_INTERVAL_IDLE_MS = 5000;
const POLL_INTERVAL_BUSY_MS = 1500;

interface ProviderProps {
  children: ReactNode;
  /** Poll interval in ms. Pass 0 to disable polling. When unset the provider
   * adapts: 1.5s while a file is being processed or queued, 5s when idle.
   * That shrinks the "no chip" gap during fast-burst pipelines (DICOM zips,
   * batch uploads) without hammering the server when idle. */
  pollMs?: number;
}

/** Provider that polls /api/pipeline/status once for the whole app and hands
 * the result to any component via useContext. Replaces the ad-hoc polling in
 * PipelineTab / DashboardPage / DocumentsPage / the metrics strip. */
export function PipelineStatusProvider({ children, pollMs }: ProviderProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = async () => {
    try {
      setLoading(true);
      const res = await api.get("/pipeline/status");
      if (aliveRef.current) setStatus(res.data);
    } catch {
      // Silently ignore — the UI just keeps showing the last known state.
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    if (pollMs === 0)
      return () => {
        aliveRef.current = false;
      };

    // Adaptive cadence — re-evaluate after every poll. The interval is reset
    // each tick so a transition from busy → idle (or vice versa) takes
    // effect immediately rather than waiting one full cycle.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const busy = !!status?.processing || (status?.queue_depth ?? 0) > 0;
      const ms =
        pollMs ?? (busy ? POLL_INTERVAL_BUSY_MS : POLL_INTERVAL_IDLE_MS);
      timer = setTimeout(async () => {
        await refresh();
        if (aliveRef.current) schedule();
      }, ms);
    };
    schedule();
    return () => {
      aliveRef.current = false;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, status?.processing, status?.queue_depth]);

  return (
    <ctx.Provider value={{ status, loading, refresh }}>{children}</ctx.Provider>
  );
}

export function usePipelineStatus() {
  return useContext(ctx);
}
