import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Shield,
  Workflow,
  Download,
  ScrollText,
  FileSearch,
  Columns3,
  Languages,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import PipelineTab from "@/components/settings/PipelineTab";
import AccessTab from "@/components/settings/AccessTab";
import LanguageTab from "@/components/settings/LanguageTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";
import ViewColumnsTab from "@/components/settings/ViewColumnsTab";

const TABS = [
  { key: "analysis", label: "Document Analysis", icon: FileSearch },
  { key: "pipeline", label: "Pipeline", icon: Workflow },
  { key: "columns", label: "Table columns", icon: Columns3 },
  { key: "language", label: "Language", icon: Languages },
  { key: "access", label: "Access & Identity", icon: Shield },
  { key: "backup", label: "Backup", icon: Download },
  { key: "logs", label: "Logs", icon: ScrollText },
] as const;

type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS: readonly TabKey[] = TABS.map((t) => t.key);
const DEFAULT_TAB: TabKey = "analysis";

function isTabKey(v: string | undefined): v is TabKey {
  return !!v && (TAB_KEYS as readonly string[]).includes(v);
}

// Old top-level slugs that now live as sub-tabs of "access". Keep these
// working so existing bookmarks (and the URL the OIDC test-config page
// links back to) don't 404.
const LEGACY_TOP_REWRITES: Record<string, string> = {
  oidc: "access/oidc",
  users: "access/users",
  sessions: "access/sessions",
};

export default function SettingsPage() {
  // URL-driven active tab so refresh / copy-paste / back-nav all land on the
  // correct page. Nested panes (Document Analysis sub-tabs, Access sub-tabs,
  // Normalization entity type) parse their own slot further down the pathname.
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split("/").filter(Boolean); // ['settings', tab?, subtab?, ...]
  const slug = segments[1];

  useEffect(() => {
    if (slug && LEGACY_TOP_REWRITES[slug]) {
      navigate(`/settings/${LEGACY_TOP_REWRITES[slug]}`, { replace: true });
    }
  }, [slug, navigate]);

  const activeTab: TabKey = isTabKey(slug) ? slug : DEFAULT_TAB;

  const setActiveTab = (key: TabKey) => {
    navigate(`/settings/${key}`, { replace: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex border-b overflow-x-auto overflow-y-hidden">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap border-b-2 -mb-px px-3 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && <DocumentAnalysisTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "columns" && <ViewColumnsTab />}
      {activeTab === "language" && <LanguageTab />}
      {activeTab === "access" && <AccessTab />}
      {activeTab === "logs" && <LogsTab />}
      {activeTab === "backup" && <BackupTab />}
    </div>
  );
}
