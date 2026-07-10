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
  ArrowLeft,
} from "lucide-react";
import DocumentAnalysisTab from "@/components/settings/DocumentAnalysisTab";
import PipelineTab from "@/components/settings/PipelineTab";
import AccessTab from "@/components/settings/AccessTab";
import LanguageTab from "@/components/settings/LanguageTab";
import BackupTab from "@/components/settings/BackupTab";
import LogsTab from "@/components/settings/LogsTab";
import SmtpTab from "@/components/settings/SmtpTab";
import ViewColumnsTab from "@/components/settings/ViewColumnsTab";
import SettingsMenuList from "@/pages/settings/SettingsMenuList";
import { useAuth } from "@/contexts/AuthContext";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import IconButton from "@/components/ui/IconButton";

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

/** One settings pane, shared between the desktop TabsContent rendering and
 *  the mobile drill-in rendering so the two stay in sync. */
function TabPane({ tab }: { tab: TabKey }) {
  switch (tab) {
    case "analysis":
      return <DocumentAnalysisTab />;
    case "pipeline":
      return <PipelineTab />;
    case "columns":
      return <ViewColumnsTab />;
    case "language":
      return <LanguageTab />;
    case "access":
      return <AccessTab />;
    case "email":
      return <SmtpTab />;
    case "logs":
      return <LogsTab />;
    case "backup":
      return <BackupTab />;
  }
}

export default function SettingsPage() {
  // URL-driven active tab so refresh / copy-paste / back-nav all land on the
  // correct page. Nested panes (Document Analysis sub-tabs, Access sub-tabs,
  // Normalization entity type) parse their own slot further down the pathname.
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDesktop } = useBreakpoint();
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
  // phase: user is still null then. Desktop falls back to the default tab;
  // below lg we go back to the bare menu URL, which is a real destination
  // there (the section list) — mobile must be able to sit at /settings.
  useEffect(() => {
    if (!user) return;
    if (slug && !LEGACY_TOP_REWRITES[slug] && !allowed) {
      navigate(isDesktop ? `/settings/${defaultTab}` : "/settings", {
        replace: true,
      });
    }
  }, [user, slug, allowed, defaultTab, navigate, isDesktop]);

  const setActiveTab = (key: TabKey) => {
    navigate(`/settings/${key}`, { replace: false });
  };

  // ── Mobile (< lg): list-first drill-in ─────────────────────────
  if (!isDesktop) {
    // Bare /settings (or a not-yet-rewritten / disallowed slug) shows the
    // section menu; a valid allowed slug shows only that pane, full-width,
    // headed by a sticky back row.
    const showPane = isTabKey(slug) && allowed;
    if (!showPane) {
      return <SettingsMenuList entries={visibleTabs} />;
    }
    const activeMeta = TABS.find((t) => t.key === activeTab)!;
    return (
      <div>
        <div className="sticky top-0 z-sticky -mx-4 bg-background/95 px-4 py-2 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            <IconButton
              label="Back to settings"
              onClick={() => navigate("/settings")}
            >
              <ArrowLeft className="h-5 w-5" />
            </IconButton>
            <h1 className="text-lg font-semibold">{activeMeta.label}</h1>
          </div>
        </div>
        <div className="pt-2">
          <TabPane tab={activeTab} />
        </div>
      </div>
    );
  }

  // ── Desktop (lg+): the tab strip; bare /settings auto-selects the
  //    default tab without rewriting the URL, exactly as before ──────
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

      {visibleTabs.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          <TabPane tab={t.key} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
