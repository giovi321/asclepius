import { useLocation, useNavigate } from "react-router-dom";
import ProvidersTab from "./ProvidersTab";
import PriorityTab from "./PriorityTab";
import PromptsTab from "./PromptsTab";
import NormalizationTab from "./NormalizationTab";

const SUB_TABS = [
  { key: "providers", label: "Providers" },
  { key: "priority", label: "Priority" },
  { key: "prompts", label: "Prompts" },
  { key: "normalization", label: "Normalization" },
] as const;

type SubTab = typeof SUB_TABS[number]["key"];
const SUB_KEYS: readonly SubTab[] = SUB_TABS.map((t) => t.key);
const DEFAULT_SUB: SubTab = "providers";

function isSubTab(v: string | undefined): v is SubTab {
  return !!v && (SUB_KEYS as readonly string[]).includes(v);
}

// Legacy slug → current slug so bookmarks / deep links survive the rename.
const LEGACY_SLUG_REWRITES: Record<string, SubTab> = {
  general: "priority",
  credentials: "providers",
  llm: "priority",
  ocr: "priority",
  vision: "priority",
};

export default function DocumentAnalysisTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split("/").filter(Boolean); // ['settings', 'analysis', subtab?, ...]
  const slug = segments[2];
  const rewritten = slug && LEGACY_SLUG_REWRITES[slug];
  const subTab: SubTab = rewritten || (isSubTab(slug) ? slug : DEFAULT_SUB);

  const setSubTab = (key: SubTab) => {
    navigate(`/settings/analysis/${key}`, { replace: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              subTab === t.key
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "providers" && <ProvidersTab />}
      {subTab === "priority" && <PriorityTab />}
      {subTab === "prompts" && <PromptsTab />}
      {subTab === "normalization" && <NormalizationTab />}
    </div>
  );
}
