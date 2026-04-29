import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import {
  FileText,
  AlertCircle,
  AlertTriangle,
  Activity,
  Clock,
  XCircle,
} from "lucide-react";
import type { PipelineStatus } from "@/types";
import { formatDocType, getBestDate, getStatusClasses } from "@/lib/utils";
import PipelineProgress from "@/components/pipeline/PipelineProgress";

export default function DashboardPage() {
  const { selectedPatient } = usePatient();
  const [documents, setDocuments] = useState<any[]>([]);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0, unclassified: 0, needs_review: 0, failed: 0 });

  const fetchData = () => {
    const params: Record<string, any> = { limit: 10 };
    if (selectedPatient) params.patient_id = selectedPatient.id;

    api.get("/documents", { params }).then((res) => {
      setDocuments(res.data.items || []);
      setStats((s) => ({ ...s, total: res.data.total || 0 }));
    });

    api.get("/documents", { params: { status: "pending,processing", limit: 1 } }).then((res) => {
      setStats((s) => ({ ...s, pending: res.data.total || 0 }));
    });

    api.get("/documents", { params: { status: "needs_review", limit: 1 } }).then((res) => {
      setStats((s) => ({ ...s, needs_review: res.data.total || 0 }));
    });

    api.get("/documents", { params: { status: "failed", limit: 1 } }).then((res) => {
      setStats((s) => ({ ...s, failed: res.data.total || 0 }));
    });

    api.get("/pipeline/status").then((res) => setPipeline(res.data));
  };

  useEffect(() => {
    fetchData();
    // Auto-refresh every 5 seconds to show pipeline progress
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [selectedPatient]);

  return (
    <div className="space-y-6">
      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={FileText}
          label="Total Documents"
          value={stats.total}
          href="/documents"
        />
        <StatCard
          icon={Clock}
          label="Pending"
          value={stats.pending}
          href="/documents?status=pending,processing"
        />
        <StatCard
          icon={AlertTriangle}
          label="Needs Review"
          value={stats.needs_review}
          href="/documents?status=needs_review"
          color={stats.needs_review > 0 ? "amber" : undefined}
        />
        <StatCard
          icon={XCircle}
          label="Failed"
          value={stats.failed}
          href="/documents?status=failed"
          color={stats.failed > 0 ? "red" : undefined}
        />
        <StatCard
          icon={AlertCircle}
          label="Unclassified"
          value={stats.unclassified}
          href="/unclassified"
        />
        <StatCard
          icon={Activity}
          label="Pipeline"
          value={pipeline?.watcher_active ? (pipeline?.processing ? "Active" : "Idle") : "Stopped"}
          href="/settings"
          color={pipeline?.watcher_active ? undefined : "red"}
        />
      </div>

      {/* Pipeline status — richer view of current job + queue */}
      {pipeline && <PipelineProgress status={pipeline} />}
      {pipeline && pipeline.recent_errors?.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">Recent errors</p>
          <div className="space-y-1">
            {pipeline.recent_errors.slice(-3).map((err: any, i: number) => (
              <p key={i} className="text-xs text-destructive">
                {err.file}: {err.error}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Recent documents */}
      <div className="rounded-lg border">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="font-medium">Recent Documents</h2>
          <Link to="/documents" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="divide-y">
          {documents.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No documents yet. Drop files into the inbox to get started.
            </p>
          ) : (
            documents.map((doc) => (
              <Link
                key={doc.id}
                to={`/documents/${doc.id}`}
                className="flex items-center justify-between p-3 hover:bg-accent/50"
              >
                <div>
                  <p className="text-sm font-medium">{doc.original_filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDocType(doc.doc_type)} | {getBestDate(doc) || "—"} | {doc.patient_name || "Unclassified"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${getStatusClasses(doc.status)}`}
                >
                  {doc.status}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  href,
  color,
}: {
  icon: any;
  label: string;
  value: string | number;
  href: string;
  color?: "red" | "amber";
}) {
  const colorClasses = color === "red"
    ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10"
    : color === "amber"
    ? "border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10"
    : "";
  const iconColor = color === "red"
    ? "text-red-500"
    : color === "amber"
    ? "text-amber-500"
    : "text-muted-foreground";
  const valueColor = color === "red"
    ? "text-red-700 dark:text-red-400"
    : color === "amber"
    ? "text-amber-700 dark:text-amber-400"
    : "";

  return (
    <Link
      to={href}
      className={`rounded-lg border p-4 transition-colors hover:bg-accent/50 ${colorClasses}`}
    >
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${iconColor}`} />
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={`text-xl font-semibold ${valueColor}`}>{value}</p>
        </div>
      </div>
    </Link>
  );
}
