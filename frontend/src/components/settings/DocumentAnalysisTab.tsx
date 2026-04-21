import { useLocation, useNavigate } from "react-router-dom";
import GeneralLlmTab from "./GeneralLlmTab";
import LlmProvidersTab from "./LlmProvidersTab";
import OcrProvidersTab from "./OcrProvidersTab";
import VisionLlmProvidersTab from "./VisionLlmProvidersTab";
import PromptsTab from "./PromptsTab";
import NormalizationTab from "./NormalizationTab";

const SUB_TABS = [
  { key: "general", label: "General" },
  { key: "llm", label: "LLM Providers" },
  { key: "ocr", label: "OCR Providers" },
  { key: "vision", label: "Vision-LLM Providers" },
  { key: "prompts", label: "Prompts" },
  { key: "normalization", label: "Normalization" },
] as const;

type SubTab = typeof SUB_TABS[number]["key"];
const SUB_KEYS: readonly SubTab[] = SUB_TABS.map((t) => t.key);
const DEFAULT_SUB: SubTab = "general";

function isSubTab(v: string | undefined): v is SubTab {
  return !!v && (SUB_KEYS as readonly string[]).includes(v);
}

export default function DocumentAnalysisTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split("/").filter(Boolean); // ['settings', 'analysis', subtab?, ...]
  const slug = segments[2];
  const subTab: SubTab = isSubTab(slug) ? slug : DEFAULT_SUB;

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

      {subTab === "general" && <GeneralLlmTab />}
      {subTab === "llm" && <LlmProvidersTab />}
      {subTab === "ocr" && <OcrProvidersTab />}
      {subTab === "vision" && <VisionLlmProvidersTab />}
      {subTab === "prompts" && <PromptsTab />}
      {subTab === "normalization" && <NormalizationTab />}
    </div>
  );
}
