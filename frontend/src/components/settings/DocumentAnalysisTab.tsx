import { useState } from "react";
import LlmProvidersTab from "./LlmProvidersTab";
import OcrProvidersTab from "./OcrProvidersTab";
import PromptsTab from "./PromptsTab";
import NormalizationTab from "./NormalizationTab";

const SUB_TABS = [
  { key: "llm", label: "LLM Providers" },
  { key: "ocr", label: "OCR Providers" },
  { key: "prompts", label: "Prompts" },
  { key: "normalization", label: "Normalization" },
] as const;

type SubTab = typeof SUB_TABS[number]["key"];

export default function DocumentAnalysisTab() {
  const [subTab, setSubTab] = useState<SubTab>("llm");

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

      {subTab === "llm" && <LlmProvidersTab />}
      {subTab === "ocr" && <OcrProvidersTab />}
      {subTab === "prompts" && <PromptsTab />}
      {subTab === "normalization" && <NormalizationTab />}
    </div>
  );
}
