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
  Mail,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import PipelineTab from "@/components/settings/PipelineTab";
import AccessTab from "@/components/settings/AccessTab";
import LanguageTab from "@/components/settings/LanguageTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";
import SmtpTab from "@/components/settings/SmtpTab";
import ViewColumnsTab from "@/components/settings/ViewColumnsTab";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";

// Tabs whose endpoints require admin role on the backend. Non-admins see
// these gone from the tab bar entirely; if they hit one of these URLs
// directly we fall back to the default visible tab.
const TABS = [
  {
    key: "analysis",
    label: "Document Analysis",
    icon: FileSearch,
    adminOnly: true,
  },
  { key: "pipeline", label: "Pipeline", icon: Workflow, adminOnly: true },
  { key: "columns", label: "Table columns", icon: Columns3, adminOnly: false },
  { key: "language", label: "Language", icon: Languages, adminOnly: true },
  { key: "access", label: "Access & Identity", icon: Shield, adminOnly: true },
  { key: "email", label: "Email", icon: Mail, adminOnly: true },
  { key: "backup", label: "Backup", icon: Download, adminOnly: true },
  { key: "logs", label: "Logs", icon: ScrollText, adminOnly: true },
] as const;

type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS: readonly TabKey[] = TABS.map((t) => t.key);
const ADMIN_DEFAULT_TAB: TabKey = "analysis";
const NON_ADMIN_DEFAULT_TAB: TabKey = "columns";

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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const segments = location.pathname.split("/").filter(Boolean); // ['settings', tab?, subtab?, ...]
  const slug = segments[1];

  useEffect(() => {
    if (slug && LEGACY_TOP_REWRITES[slug]) {
      navigate(`/settings/${LEGACY_TOP_REWRITES[slug]}`, { replace: true });
    }
  }, [slug, navigate]);

  const visibleTabs = TABS.filter((t) => isAdmin || !t.adminOnly);
  const defaultTab: TabKey = isAdmin
    ? ADMIN_DEFAULT_TAB
    : NON_ADMIN_DEFAULT_TAB;
  const requestedTab: TabKey = isTabKey(slug) ? slug : defaultTab;
  const requestedMeta = TABS.find((t) => t.key === requestedTab);
  const allowed = !!requestedMeta && (isAdmin || !requestedMeta.adminOnly);
  const activeTab: TabKey = allowed ? requestedTab : defaultTab;

  // If a non-admin lands on /settings/<admin-tab>, rewrite the URL so refresh
  // and bookmarks resolve cleanly. Don't redirect during the auth-loading
  // phase: user is still null then.
  useEffect(() => {
    if (!user) return;
    if (slug && !LEGACY_TOP_REWRITES[slug] && !allowed) {
      navigate(`/settings/${defaultTab}`, { replace: true });
    }
  }, [user, slug, allowed, defaultTab, navigate]);

  const setActiveTab = (key: TabKey) => {
    navigate(`/settings/${key}`, { replace: false });
  };

  return (
    <Tabs
      value={activeTab}
      onValueChange={(key) => setActiveTab(key as TabKey)}
      className="space-y-4"
    >
      {/* Scrollable strip: tabs keep their natural width and overflow
          horizontally instead of squeezing (the old flex-1 crushed all
          eight labels at narrow widths). */}
      <TabsList>
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          return (
            <TabsTrigger key={t.key} value={t.key}>
              <Icon className="h-4 w-4" />
              {t.label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="analysis">
        <DocumentAnalysisTab />
      </TabsContent>
      <TabsContent value="pipeline">
        <PipelineTab />
      </TabsContent>
      <TabsContent value="columns">
        <ViewColumnsTab />
      </TabsContent>
      <TabsContent value="language">
        <LanguageTab />
      </TabsContent>
      <TabsContent value="access">
        <AccessTab />
      </TabsContent>
      <TabsContent value="email">
        <SmtpTab />
      </TabsContent>
      <TabsContent value="logs">
        <LogsTab />
      </TabsContent>
      <TabsContent value="backup">
        <BackupTab />
      </TabsContent>
    </Tabs>
  );
}
