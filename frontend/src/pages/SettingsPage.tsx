import { useLocation, useNavigate } from "react-router-dom";
import {
  Users, Shield, Workflow, Download, ScrollText, FileSearch, KeyRound, Key,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import CredentialsTab from "@/components/settings/CredentialsTab";
import PipelineTab from "@/components/settings/PipelineTab";
import OidcTab from "@/components/settings/OidcTab";
import UsersTab from "@/components/settings/UsersTab";
import SessionsTab from "@/components/settings/SessionsTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";

const TABS = [
  { key: "analysis", label: "Document Analysis", icon: FileSearch },
  { key: "credentials", label: "Credentials", icon: Key },
  { key: "pipeline", label: "Pipeline", icon: Workflow },
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
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-1.5 rounded-lg border p-1.5 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && <DocumentAnalysisTab />}
      {activeTab === "credentials" && <CredentialsTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "oidc" && <OidcTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "sessions" && <SessionsTab />}
      {activeTab === "logs" && <LogsTab />}
      {activeTab === "backup" && <BackupTab />}
    </div>
  );
}
