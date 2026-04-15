import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";

export default function LogsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [total, setTotal] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(() => {
    const params: Record<string, any> = { limit: 500 };
    if (levelFilter) params.level = levelFilter;
    if (moduleFilter) params.module = moduleFilter;
    api.get("/settings/logs", { params })
      .then((res) => { setLogs(res.data.logs || []); setTotal(res.data.total || 0); })
      .catch(() => {});
  }, [levelFilter, moduleFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const levelColor = (level: string) => {
    switch (level) {
      case "ERROR": return "text-red-500";
      case "WARNING": return "text-yellow-500";
      case "DEBUG": return "text-muted-foreground/60";
      default: return "text-foreground";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-xs">
          <option value="">All levels</option>
          <option value="ERROR">Errors only</option>
          <option value="WARNING,ERROR">Warnings + Errors</option>
          <option value="INFO">Info only</option>
          <option value="DEBUG">Debug</option>
        </select>
        <input type="text" placeholder="Filter by module..." value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="rounded-md border bg-background px-2 py-1.5 text-xs w-48" />
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh (3s)
        </label>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
        <button onClick={fetchLogs} className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent">
          Refresh
        </button>
        <span className="text-xs text-muted-foreground ml-auto">{total} total log entries</span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div ref={scrollRef} className="max-h-[600px] overflow-y-auto font-mono text-[11px] leading-5 bg-black/5 dark:bg-white/5">
          {logs.length === 0 ? (
            <p className="p-4 text-muted-foreground text-center">No logs found</p>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`flex gap-2 px-3 py-0.5 border-b border-border/30 hover:bg-accent/30 ${levelColor(log.level)}`}>
                <span className="text-muted-foreground/70 flex-shrink-0 w-[140px]">{log.ts}</span>
                <span className={`flex-shrink-0 w-[55px] font-bold ${levelColor(log.level)}`}>{log.level}</span>
                <span className="text-muted-foreground/70 flex-shrink-0 w-[200px] truncate">{log.module}</span>
                <span className="flex-1 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
