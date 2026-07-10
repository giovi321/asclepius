import { useMemo, useState } from "react";
import { Crop, FileText } from "lucide-react";
import api from "@/api/client";
import { useLlmProviders, useOcrProviders } from "@/hooks/data";
import ProviderSelect, { type Provider } from "@/components/ui/ProviderSelect";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";

export interface TranslateOptionsPanelProps {
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
  /** Close the hosting Sheet/Popover once the job has been kicked off. */
  onClose: () => void;
}

type Tab = "doc" | "region";

/**
 * Translate form body: mode tabs (whole document vs region-on-PDF) +
 * provider selects. Presentation-free — host it in a Sheet (this file's
 * default export) or any other container.
 */
export function TranslateOptionsPanel({
  docId,
  hasOcrText,
  canSelectRegion,
  onTranslated,
  onStartRegionSelection,
  onClose,
}: TranslateOptionsPanelProps) {
  const docDisabled = !hasOcrText;
  const regionDisabled = !canSelectRegion;
  const [tab, setTab] = useState<Tab>(docDisabled ? "region" : "doc");
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

  const handleStartDoc = async () => {
    onClose();
    await api.post(`/documents/${docId}/translate`, {
      ...(llmId ? { llm_provider_id: llmId } : {}),
    });
    await onTranslated();
  };

  const handleStartRegion = () => {
    onClose();
    onStartRegionSelection({
      ocrProviderId: ocrId || null,
      llmProviderId: llmId || null,
    });
  };

  return (
    <div className="space-y-3">
      {/* Tab switcher */}
      <div className="flex rounded-md border p-0.5 bg-muted/40">
        <button
          type="button"
          onClick={() => setTab("doc")}
          disabled={docDisabled}
          className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors coarse:min-h-11 ${
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
          className={`flex-1 flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors coarse:min-h-11 ${
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
            Translate the document body to English. Only prose is translated;
            names, dates, codes, and values stay as-is.
          </p>
          {llmProviders.length === 0 ? (
            <p className="text-xs text-warning">
              No text LLM providers enabled. Add one under Settings.
            </p>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                LLM Provider
              </p>
              <ProviderSelect
                kind="llm"
                value={llmId}
                onChange={setLlmId}
                options={llmProviders}
              />
            </div>
          )}
          <Button
            onClick={handleStartDoc}
            disabled={llmProviders.length === 0 || docDisabled}
            className="w-full"
          >
            Start Translation
          </Button>
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            OCR and translate a portion of the PDF. After clicking below, click
            and drag on the page to select a region.
          </p>
          {ocrProviders.length === 0 ? (
            <p className="text-xs text-warning">
              No OCR providers enabled. Add one under Settings.
            </p>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                OCR Engine
              </p>
              <ProviderSelect
                kind="ocr"
                value={ocrId}
                onChange={setOcrId}
                options={ocrProviders}
              />
            </div>
          )}
          {llmProviders.length === 0 ? (
            <p className="text-xs text-warning">
              No text LLM providers enabled. Add one under Settings.
            </p>
          ) : (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">
                LLM Provider
              </p>
              <ProviderSelect
                kind="llm"
                value={llmId}
                onChange={setLlmId}
                options={llmProviders}
              />
            </div>
          )}
          <Button
            onClick={handleStartRegion}
            disabled={
              ocrProviders.length === 0 ||
              llmProviders.length === 0 ||
              regionDisabled
            }
            className="w-full"
          >
            <Crop className="h-3.5 w-3.5" /> Select region on PDF
          </Button>
        </>
      )}
    </div>
  );
}

export interface TranslateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docId: number | string;
  hasOcrText: boolean;
  canSelectRegion: boolean;
  onTranslated: () => Promise<void> | void;
  onStartRegionSelection: (providers: {
    ocrProviderId: string | null;
    llmProviderId: string | null;
  }) => void;
}

/**
 * Sheet-hosted translate flow: bottom sheet on phones, centered dialog on
 * larger screens. Opened from the header's DetailActionsMenu. Region mode
 * closes the sheet and hands off to the PDF viewer's selection mode.
 */
export default function TranslateSheet({
  open,
  onOpenChange,
  docId,
  hasOcrText,
  canSelectRegion,
  onTranslated,
  onStartRegionSelection,
}: TranslateSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Translate document"
      contentClassName="sm:max-w-md"
    >
      <TranslateOptionsPanel
        docId={docId}
        hasOcrText={hasOcrText}
        canSelectRegion={canSelectRegion}
        onTranslated={onTranslated}
        onStartRegionSelection={onStartRegionSelection}
        onClose={() => onOpenChange(false)}
      />
    </Sheet>
  );
}
