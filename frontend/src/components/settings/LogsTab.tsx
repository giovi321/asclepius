import { useCallback, useEffect, useRef, useState } from "react";
import api from "@/api/client";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";

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
    api
      .get("/settings/logs", { params })
      .then((res) => {
        setLogs(res.data.logs || []);
        setTotal(res.data.total || 0);
      })
      .catch(() => {});
  }, [levelFilter, moduleFilter]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

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
      case "ERROR":
        return "text-destructive";
      case "WARNING":
        return "text-warning";
      case "DEBUG":
        return "text-muted-foreground/60";
      default:
        return "text-foreground";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="w-auto"
        >
          <option value="">All levels</option>
          <option value="ERROR">Errors only</option>
          <option value="WARNING,ERROR">Warnings + Errors</option>
          <option value="INFO">Info only</option>
          <option value="DEBUG">Debug</option>
        </Select>
        <Input
          type="text"
          placeholder="Filter by module..."
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="w-48"
        />
        <label className="flex items-center gap-1.5 text-xs coarse:min-h-11">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="coarse:h-5 coarse:w-5"
          />
          Auto-refresh (3s)
        </label>
        <label className="flex items-center gap-1.5 text-xs coarse:min-h-11">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="coarse:h-5 coarse:w-5"
          />
          Auto-scroll
        </label>
        <Button variant="secondary" onClick={fetchLogs}>
          Refresh
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {total} total log entries
        </span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div
          ref={scrollRef}
          className="max-h-[600px] overflow-y-auto font-mono text-[11px] leading-5 bg-black/5 dark:bg-white/5"
        >
          {logs.length === 0 ? (
            <p className="p-4 text-muted-foreground text-center">
              No logs found
            </p>
          ) : (
            // Below md each entry renders as two lines (meta line, then the
            // wrapping message); md+ keeps the original fixed-width columns
            // via md:contents so the inner wrapper dissolves into the row.
            logs.map((log, i) => (
              <div
                key={i}
                className={`border-b border-border/30 px-3 py-1 hover:bg-accent/30 md:flex md:gap-2 md:py-0.5 ${levelColor(log.level)}`}
              >
                <div className="flex min-w-0 items-baseline gap-2 md:contents">
                  <span className="shrink-0 text-muted-foreground/70 md:w-[140px]">
                    {log.ts}
                  </span>
                  <span
                    className={`shrink-0 font-bold md:w-[55px] ${levelColor(log.level)}`}
                  >
                    {log.level}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground/70 md:w-[200px] md:flex-shrink-0">
                    {log.module}
                  </span>
                </div>
                <span className="block break-words md:flex-1 md:break-all">
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
