import { useEffect, useState } from "react";
import api from "@/api/client";
import { Save, RotateCcw } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";

export default function PromptsTab() {
  const { toast } = useToast();
  const [prompts, setPrompts] = useState<any[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.get("/settings/prompts").then((res) => setPrompts(res.data || []));
  };

  useEffect(() => { load(); }, []);

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      await api.put(`/settings/prompts/${key}`, { text: editText });
      setEditing(null);
      load();
    } catch { toast({ title: "Failed to save prompt", variant: "error" }); }
    setSaving(false);
  };

  const handleReset = async (key: string) => {
    if (!confirm("Reset this prompt to the default? Your customization will be lost.")) return;
    try {
      await api.delete(`/settings/prompts/${key}`);
      setEditing(null);
      load();
    } catch { toast({ title: "Failed to reset", variant: "error" }); }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
        Customize the LLM prompts used for document classification, extraction, chat, and more.
        Prompts use Python format strings with placeholders like {"{ocr_text}"}, {"{patient_list}"}, etc.
        Click a prompt to edit it. Reset to revert to the default.
      </div>
      {prompts.map((p) => (
        <div key={p.key} className="rounded-lg border">
          <div
            className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent/30"
            onClick={() => {
              if (editing === p.key) { setEditing(null); }
              else { setEditing(p.key); setEditText(p.text); }
            }}
          >
            <div>
              <span className="text-sm font-medium">{p.key.replace(/_/g, " ")}</span>
              {p.is_custom && (
                <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">customized</span>
              )}
              <p className="text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">{p.text?.length || 0} chars</span>
          </div>
          {editing === p.key && (
            <div className="border-t p-3 space-y-2">
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-xs font-mono min-h-[200px]"
                disabled={saving}
              />
              <div className="flex gap-2">
                <button onClick={() => handleSave(p.key)} disabled={saving}
                  className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
                  <Save className="h-3 w-3" /> {saving ? "Saving..." : "Save"}
                </button>
                {p.is_custom && (
                  <button onClick={() => handleReset(p.key)}
                    className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
                    <RotateCcw className="h-3 w-3" /> Reset to default
                  </button>
                )}
                <button onClick={() => setEditing(null)} className="rounded-md border px-3 py-1.5 text-xs">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
