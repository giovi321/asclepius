import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Crop, FileText, Languages } from "lucide-react";
import api from "@/api/client";
import { useLlmProviders, useOcrProviders } from "@/hooks/data";

export interface TranslateMenuProps {
  docId: number | string;
  hasOcrText: boolean;
  /** True when the document has a PDF file we can crop a region out of.
   * Region translate is hidden when there's no file to operate on. */
  canSelectRegion: boolean;
  onTranslated: () => Promise<void> | void;
  /** Called when the user picks "Region on PDF" → "Select region": the
   * parent puts the PDF viewer into selection mode and the user drags
   * a rectangle. The provider IDs here are pre-resolved so the
   * region-translate POST can use them as-is. */
  onStartRegionSelection: (providers: {
    ocrProviderId: string | null;
    llmProviderId: string | null;
  }) => void;
}

interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

type Tab = "doc" | "region";

/**
 * "Translate" button in the document header. The popover offers two
 * modes: whole-document translation (re-uses cached OCR text) and
 * region translation (crop a rectangle on the PDF, OCR + translate that
 * crop only).
 */
export default function TranslateMenu({
  docId,
  hasOcrText,
  canSelectRegion,
  onTranslated,
  onStartRegionSelection,
}: TranslateMenuProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("doc");
  const { data: llmAll } = useLlmProviders();
  const { data: ocrAll } = useOcrProviders();
  const llmProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(llmAll) ? llmAll : []).filter((p: Provider) => p.enabled),
    [llmAll],
  );
  const ocrProviders: Provider[] = useMemo(
    () =>
      (Array.isArray(ocrAll) ? ocrAll : []).filter((p: Provider) => p.enabled),
    [ocrAll],
  );
  const [llmId, setLlmId] = useState("");
  const [ocrId, setOcrId] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleStartDoc = async () => {
    setOpen(false);
    await api.post(`/documents/${docId}/translate`, {
      ...(llmId ? { llm_provider_id: llmId } : {}),
    });
    await onTranslated();
  };

  const handleStartRegion = () => {
    setOpen(false);
    onStartRegionSelection({
      ocrProviderId: ocrId || null,
      llmProviderId: llmId || null,
    });
  };

  // The button is disabled only when BOTH modes are unavailable. When
  // OCR is missing the user can still kick off a region translate
  // (which OCRs the crop), and vice versa.
  const docDisabled = !hasOcrText;
  const regionDisabled = !canSelectRegion;
  const allDisabled = docDisabled && regionDisabled;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !allDisabled && setOpen(!open)}
        disabled={allDisabled}
        title={
          allDisabled
            ? "No OCR text and no PDF file to translate."
            : "Translate the document body or a selected region"
        }
        className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Languages className="h-4 w-4" /> Translate{" "}
        <ChevronDown className="h-3 w-3 ml-0.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-80 rounded-lg border bg-background shadow-xl p-3 space-y-3">
          {/* Tab switcher */}
          <div className="flex rounded-md border p-0.5 bg-muted/40">
            <button
              type="button"
              onClick={() => setTab("doc")}
              disabled={docDisabled}
              className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                tab === "doc"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={
                docDisabled
                  ? "Document has no OCR text yet."
                  : "Translate the entire document body"
              }
            >
              <FileText className="h-3 w-3" /> Whole document
            </button>
            <button
              type="button"
              onClick={() => setTab("region")}
              disabled={regionDisabled}
              className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                tab === "region"
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              title={
                regionDisabled
                  ? "No PDF file to crop a region from."
                  : "OCR + translate a rectangle on the page"
              }
            >
              <Crop className="h-3 w-3" /> Region on PDF
            </button>
          </div>

          {tab === "doc" ? (
            <>
              <p className="text-xs text-muted-foreground">
                Translate the document body to English. Only prose is
                translated; names, dates, codes, and values stay as-is.
              </p>
              {llmProviders.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No text LLM providers enabled. Add one under Settings.
                </p>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    LLM Provider
                  </p>
                  <select
                    value={llmId}
                    onChange={(e) => setLlmId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Default (highest priority)</option>
                    {llmProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={handleStartDoc}
                disabled={llmProviders.length === 0 || docDisabled}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Start Translation
              </button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                OCR and translate a portion of the PDF. After clicking below,
                click and drag on the page to select a region.
              </p>
              {ocrProviders.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No OCR providers enabled. Add one under Settings.
                </p>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    OCR Engine
                  </p>
                  <select
                    value={ocrId}
                    onChange={(e) => setOcrId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Default (highest priority)</option>
                    {ocrProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {llmProviders.length === 0 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  No text LLM providers enabled. Add one under Settings.
                </p>
              ) : (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    LLM Provider
                  </p>
                  <select
                    value={llmId}
                    onChange={(e) => setLlmId(e.target.value)}
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  >
                    <option value="">Default (highest priority)</option>
                    {llmProviders.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name || p.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={handleStartRegion}
                disabled={
                  ocrProviders.length === 0 ||
                  llmProviders.length === 0 ||
                  regionDisabled
                }
                className="w-full flex items-center justify-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Crop className="h-3.5 w-3.5" /> Select region on PDF
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
