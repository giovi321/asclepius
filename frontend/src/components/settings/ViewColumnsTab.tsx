import { useColumnPrefs } from "@/lib/columnPrefs";
import {
  COLUMNS as DOC_COLUMNS,
  DOCUMENTS_DEFAULTS,
} from "@/components/documents/columns";
import {
  IMAGING_COLUMNS,
  IMAGING_DEFAULTS,
} from "@/components/imaging/columns";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

/** Settings tab: per-user visibility + ordering for the table-style list
 * views (Documents, Imaging). Lab Results uses a grouped/expandable layout
 * rather than fixed columns and is excluded for now.
 *
 * Persisted to ``user_view_prefs`` via /api/settings/view-prefs/{view_key}
 * so the choice follows the user across devices. */
export default function ViewColumnsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold mb-1">Table columns</h2>
        <p className="text-sm text-muted-foreground">
          Pick which columns appear in each list view, and reorder them. Saves
          automatically.
        </p>
      </div>

      <ViewSection
        title="Documents"
        viewKey="documents"
        defs={DOC_COLUMNS.map((c) => ({
          key: c.key as string,
          label: c.label,
        }))}
        defaults={DOCUMENTS_DEFAULTS}
      />

      <ViewSection
        title="Imaging"
        viewKey="imaging"
        defs={IMAGING_COLUMNS.map((c) => ({
          key: c.key as string,
          label: c.label,
        }))}
        defaults={IMAGING_DEFAULTS}
      />

      <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        Lab tests view uses a grouped layout (not a flat column list) and isn't
        configurable from here yet. It's tracked for the next release.
      </div>
    </div>
  );
}

function ViewSection({
  title,
  viewKey,
  defs,
  defaults,
}: {
  title: string;
  viewKey: "documents" | "imaging";
  defs: { key: string; label: string }[];
  defaults: { visible: string[]; order: string[] };
}) {
  const prefs = useColumnPrefs(viewKey, defaults);

  // Render columns in the user's order, then any leftover (not yet ordered)
  // columns at the end so newly-added registry entries surface even if the
  // saved row predates them.
  const ordered = [
    ...prefs.order.filter((k) => defs.some((d) => d.key === k)),
    ...defs.map((d) => d.key).filter((k) => !prefs.order.includes(k)),
  ];

  const toggle = (k: string) => {
    const next = new Set(prefs.visible);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    prefs.setVisible(Array.from(next));
  };

  const move = (k: string, dir: "up" | "down") => {
    const idx = ordered.indexOf(k);
    if (idx < 0) return;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= ordered.length) return;
    const next = [...ordered];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    prefs.setOrder(next);
  };

  const reset = () => {
    prefs.setVisible(defaults.visible);
    prefs.setOrder(defaults.order);
  };

  if (!prefs.loaded) {
    return (
      <div className="rounded-lg border p-4">
        <h3 className="font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground mt-2">Loading...</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium">{title}</h3>
        <button
          onClick={reset}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          title="Reset to defaults"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>
      <ul className="divide-y rounded-md border">
        {ordered.map((k, i) => {
          const def = defs.find((d) => d.key === k);
          if (!def) return null;
          const visible = prefs.visible.includes(k);
          return (
            <li key={k} className="flex items-center gap-2 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={visible}
                onChange={() => toggle(k)}
                className="h-4 w-4"
              />
              <span
                className={`flex-1 ${visible ? "" : "text-muted-foreground/60"}`}
              >
                {def.label}
              </span>
              <button
                onClick={() => move(k, "up")}
                disabled={i === 0}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
                title="Move up"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(k, "down")}
                disabled={i === ordered.length - 1}
                className="rounded p-1 hover:bg-accent disabled:opacity-30"
                title="Move down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
