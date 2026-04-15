import { useState } from "react";
import {
  Users, Shield, Workflow, Download, ScrollText, FileSearch,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import PipelineTab from "@/components/settings/PipelineTab";
import OidcTab from "@/components/settings/OidcTab";
import UsersTab from "@/components/settings/UsersTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";

const TABS = [
  { key: "analysis", label: "Document Analysis", icon: FileSearch },
  { key: "pipeline", label: "Pipeline", icon: Workflow },
  { key: "oidc", label: "OIDC / SSO", icon: Shield },
  { key: "users", label: "Users", icon: Users },
  { key: "backup", label: "Backup", icon: Download },
  { key: "logs", label: "Logs", icon: ScrollText },
] as const;

type TabKey = typeof TABS[number]["key"];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("analysis");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-1.5 rounded-lg border p-1.5 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "analysis" && <DocumentAnalysisTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "oidc" && <OidcTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "logs" && <LogsTab />}
      {activeTab === "backup" && <BackupTab />}
    </div>
  );
}

