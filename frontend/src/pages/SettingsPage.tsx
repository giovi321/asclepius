import { useLocation, useNavigate } from "react-router-dom";
import {
  Users, Shield, Workflow, Download, ScrollText, FileSearch, KeyRound, Columns3,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import PipelineTab from "@/components/settings/PipelineTab";
import OidcTab from "@/components/settings/OidcTab";
import UsersTab from "@/components/settings/UsersTab";
import SessionsTab from "@/components/settings/SessionsTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";
import ViewColumnsTab from "@/components/settings/ViewColumnsTab";

const TABS = [
  { key: "analysis", label: "Document Analysis", icon: FileSearch },
  { key: "pipeline", label: "Pipeline", icon: Workflow },
  { key: "columns", label: "Table columns", icon: Columns3 },
  { key: "oidc", label: "OIDC / SSO", icon: Shield },
  { key: "users", label: "Users", icon: Users },
  { key: "sessions", label: "Sessions", icon: KeyRound },
  { key: "backup", label: "Backup", icon: Download },
  { key: "logs", label: "Logs", icon: ScrollText },
] as const;

type TabKey = typeof TABS[number]["key"];
const TAB_KEYS: readonly TabKey[] = TABS.map((t) => t.key);
const DEFAULT_TAB: TabKey = "analysis";

function isTabKey(v: string | undefined): v is TabKey {
  return !!v && (TAB_KEYS as readonly string[]).includes(v);
}

export default function SettingsPage() {
  // URL-driven active tab so refresh / copy-paste / back-nav all land on the
  // correct page. Nested panes (Document Analysis sub-tabs, Normalization
  // entity type) parse their own slot further down the pathname.
  const location = useLocation();
  const navigate = useNavigate();

  const segments = location.pathname.split("/").filter(Boolean); // ['settings', tab?, subtab?, ...]
  const slug = segments[1];
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
      {activeTab === "oidc" && <OidcTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "sessions" && <SessionsTab />}
      {activeTab === "logs" && <LogsTab />}
      {activeTab === "backup" && <BackupTab />}
    </div>
  );
}
