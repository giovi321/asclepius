import { useEffect, useState } from "react";
import api from "@/api/client";
import { Save, RotateCcw, Languages } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useSettings } from "@/hooks/data";

// Canonical output languages. Extend freely — the backend accepts any string
// and embeds it verbatim into the LLM language directive.
const CANONICAL_LANGUAGES = [
  "English",
  "Italian",
  "German",
  "French",
  "Spanish",
  "Portuguese",
  "Dutch",
  "Polish",
  "Romanian",
  "Czech",
];

export default function PromptsTab() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [prompts, setPrompts] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [canonicalLanguage, setCanonicalLanguage] = useState<string>("English");
  const [savingLanguage, setSavingLanguage] = useState(false);

  const { data: settingsData } = useSettings();

  const load = () => {
    api.get("/settings/prompts").then((res) => setPrompts(res.data || []));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (settingsData)
      setCanonicalLanguage(settingsData?.llm?.canonical_language || "English");
  }, [settingsData]);

  const saveLanguage = async (value: string) => {
    setSavingLanguage(true);
    try {
      await api.patch("/settings", { canonical_language: value });
      setCanonicalLanguage(value);
      toast({
        title: "Canonical language updated",
        description: `All LLM output will now be in ${value}.`,
      });
    } catch {
      toast({ title: "Failed to update canonical language", variant: "error" });
    }
    setSavingLanguage(false);
  };

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await api.put(`/settings/prompts/${key}`, { text: editText });
      setEditing(null);
      load();
    } catch {
      toast({ title: "Failed to save prompt", variant: "error" });
    }
    setSaving(false);
  };

  const handleReset = async (key: string) => {
    const ok = await confirm({
      title: "Reset this prompt to the default?",
      description: "Your customization will be lost.",
      confirmText: "Reset",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/settings/prompts/${key}`);
      setEditing(null);
      load();
    } catch {
      toast({ title: "Failed to reset", variant: "error" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Languages className="h-4 w-4 text-primary" />
          Canonical output language
        </div>
        <p className="text-xs text-muted-foreground">
          Every free-form field produced by the LLM (summaries, canonical names,
          findings, notes, etc.) will be written in this language, regardless of
          the document's source language. Codes (ICD-10, LOINC, ISO 4217, etc.)
          are always kept as-is.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={canonicalLanguage}
            onChange={(e) => saveLanguage(e.target.value)}
            disabled={savingLanguage}
            className="rounded-md border bg-background px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {CANONICAL_LANGUAGES.includes(canonicalLanguage) ? null : (
              <option value={canonicalLanguage}>{canonicalLanguage}</option>
            )}
            {CANONICAL_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
          {savingLanguage && (
            <span className="text-xs text-muted-foreground">Saving…</span>
          )}
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Customize the LLM prompts used for document classification, extraction,
        chat, and more. Prompts are Python{" "}
        <code className="font-mono text-xs">str.format()</code> templates —
        expand a prompt to see the exact{" "}
        <code className="font-mono text-xs">{"{variable}"}</code> placeholders
        it supports. Click a prompt to edit it. Reset to revert to the default.
      </div>
      {prompts.map((p) => (
        <div key={p.key} className="rounded-lg border">
          <div
            className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent/30"
            onClick={() => {
              if (editing === p.key) {
                setEditing(null);
              } else {
                setEditing(p.key);
                setEditText(p.text);
              }
            }}
          >
            <div>
              <span className="text-sm font-medium">
                {p.key.replace(/_/g, " ")}
              </span>
              {p.is_custom && (
                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  customized
                </span>
              )}
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">
              {p.text?.length || 0} chars
            </span>
          </div>
          {editing === p.key && (
            <div className="border-t p-3 space-y-2">
              {p.variables && p.variables.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium">Available variables</div>
                  <div className="flex flex-wrap gap-1">
                    {p.variables.map((v: any) => (
                      <button
                        key={v.name}
                        type="button"
                        title={`${v.description}${v.optional ? " (optional)" : ""}\n\nClick to copy`}
                        onClick={() => {
                          const token = `{${v.name}}`;
                          navigator.clipboard?.writeText(token);
                          toast({ title: `Copied ${token}` });
                        }}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-accent"
                      >
                        {`{${v.name}}`}
                        {v.optional ? "?" : ""}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Click a chip to copy the placeholder. Variables marked with{" "}
                    <code className="font-mono">?</code> are optional —
                    substituted only if the placeholder actually appears in the
                    template. Using an unknown placeholder will break
                    extraction.
                  </p>
                </div>
              )}
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono min-h-[200px]"
                disabled={saving}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleSave(p.key)}
                  disabled={saving}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save"}
                </button>
                {p.is_custom && (
                  <button
                    onClick={() => handleReset(p.key)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    <RotateCcw className="h-3 w-3" /> Reset to default
                  </button>
                )}
                <button
                  onClick={() => setEditing(null)}
                  className="rounded-md border px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
