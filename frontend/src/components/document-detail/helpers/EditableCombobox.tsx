import { useRef, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { useDoctors, useFacilities, useSpecialties } from "@/hooks/data";
import { useOnClickOutside } from "@/hooks/useOnClickOutside";
import { ActionButton, IconButton } from "./inlineEditPrimitives";

/** Proper singular noun for each normalization entity type. The previous
 * copy used ``normType.slice(0, -1)`` which produced "facilitie" and
 * "specialtie" — close, no cigar. */
const NORM_SINGULAR: Record<"doctors" | "facilities" | "specialties", string> =
  {
    doctors: "doctor",
    facilities: "facility",
    specialties: "specialty",
  };

// ─── EditableCombobox ─────────────────────────────────────────
// Searchable dropdown backed by a normalization endpoint (doctors, facilities,
// specialties). Shows existing entries filtered by the typed query, plus a
// "+ Create new" row when the query has no exact match. Selecting an existing
// entry sends the chosen display name to the backend; the PATCH handler on
// documents will resolve it to an id via the alias-aware _upsert_* helpers.

export function EditableCombobox({
  label,
  value,
  field,
  docId,
  onSave,
  normType,
  currentEntityId,
}: {
  label: string;
  value: any;
  field: string;
  docId: number;
  onSave: (updated?: any) => void;
  normType: "doctors" | "facilities" | "specialties";
  /** Required for the scope confirm to fire. When the field already
   * carries an entity id and the user picks/types a new value, the
   * combobox always asks whether the change should apply to this
   * document only or to every document linked to the current entity.
   * Without it, only the doc-only path is offered. */
  currentEntityId?: number | null;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  // Pending change pending the scope choice. `entityId` is the resolved
  // existing entry's id when the user picked from the dropdown; null
  // when they typed a new value (which would be auto-created on commit).
  const [pendingChange, setPendingChange] = useState<{
    display: string;
    entityId: number | null;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const singular = NORM_SINGULAR[normType];
  const fromLabel = String(value || "").trim();

  const doctors = useDoctors();
  const facilities = useFacilities();
  const specialties = useSpecialties();
  const source =
    normType === "doctors"
      ? doctors
      : normType === "facilities"
        ? facilities
        : specialties;
  const options = Array.isArray(source.data) ? source.data : [];
  const loadingOptions = source.loading;

  // Close on outside click
  useOnClickOutside(
    rootRef,
    () => {
      setEditing(false);
      setQuery("");
      setPendingChange(null);
    },
    editing,
  );

  const displayOf = (opt: any) =>
    opt.canonical_display || opt.name || opt.display || "";

  /** Apply the change to THIS document only — repoint its FK, leave the
   * canonical row untouched. The backend's _upsert_* helpers resolve the
   * display name to an existing entry by alias/slug, or auto-create one
   * if there's no match. */
  const commitDocOnly = async (chosen: string | null) => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { [field]: chosen });
      onSave(res.data);
      setEditing(false);
      setQuery("");
      setPendingChange(null);
    } catch (err: any) {
      const d = getErrorMessage(err, "Failed to save");
      toast({
        title: typeof d === "string" ? d : "Failed to save",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  /** Apply the change to EVERY document currently linked to the
   * ``currentEntityId``. The strategy depends on whether the user picked
   * an existing entry or typed a new one:
   *
   * - Picked existing entry (``targetEntityId`` known) → merge the
   *   current entity into the picked one. Every document that pointed
   *   at the old entity now points at the picked entity, and the old
   *   entity row is deleted (its name copied as an alias on the target).
   * - Typed a new name → rename the current entity's
   *   ``canonical_display``. The FK stays put; every linked document
   *   simply renders the new name through the join.
   */
  const applyToAllDocuments = async (
    newDisplay: string,
    targetEntityId: number | null,
  ) => {
    if (!currentEntityId) {
      // No existing entity to mutate — fall back to doc-only.
      await commitDocOnly(newDisplay);
      return;
    }
    // Bulk action — get explicit user confirmation. The merge / rename
    // path cascades through every linked row, so the blast radius is
    // potentially much larger than just the current document.
    const isMerge = !!(targetEntityId && targetEntityId !== currentEntityId);
    const ok = await confirm({
      title: isMerge
        ? `Merge "${fromLabel}" into "${newDisplay}"?`
        : `Rename "${fromLabel}" to "${newDisplay}"?`,
      description: isMerge
        ? `Every document, encounter and other record currently labelled "${fromLabel}" will be relabelled "${newDisplay}". The "${fromLabel}" ${singular} record will be deleted and its aliases moved onto "${newDisplay}". This affects all linked records, not just the current document.`
        : `The ${singular} record currently called "${fromLabel}" will be renamed to "${newDisplay}". Every document, encounter and other record linked to it will display the new name. This affects all linked records, not just the current document.`,
      confirmText: isMerge ? "Merge all" : "Rename all",
      cancelText: "Cancel",
      variant: "destructive",
    });
    if (!ok) return;
    setSaving(true);
    try {
      if (targetEntityId && targetEntityId !== currentEntityId) {
        // Merge: every doc pointing at currentEntityId becomes a doc
        // pointing at targetEntityId. The merge endpoint also copies
        // the source's display name as an alias on the target so the
        // few-shot retriever picks it up next time.
        await api.post(`/normalization/${normType}/merge`, {
          source_id: currentEntityId,
          target_id: targetEntityId,
        });
      } else {
        // Rename: change the canonical row's display name in place.
        await api.patch(`/normalization/${normType}/${currentEntityId}`, {
          canonical_display: newDisplay,
        });
      }
      // Refetch the document so the parent state picks up the new
      // joined display name. Without this the page keeps showing the
      // old name until the user reloads, because merge/rename mutate
      // a different table than the document row.
      try {
        const fresh = await api.get(`/documents/${docId}`);
        onSave(fresh.data);
      } catch {
        // Worst case the parent keeps stale state; the underlying
        // change has still been persisted server-side.
        onSave();
      }
      setEditing(false);
      setQuery("");
      setPendingChange(null);
    } catch (err: any) {
      const d = getErrorMessage(err, "Failed to apply");
      toast({
        title: typeof d === "string" ? d : "Failed to apply",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  /** Decide whether to commit straight through (no scope ambiguity) or
   * raise the two-button picker. The picker fires when:
   *   - the field already has a current entity (something to mutate), AND
   *   - the new value differs from the current display, AND
   *   - the new value is non-empty (clear has its own button).
   * Without a current entity we can't "apply to all" — there's nothing
   * to rename or merge from — so we go straight to doc-only. */
  const handleCommit = (newDisplay: string, targetEntityId: number | null) => {
    const trimmed = (newDisplay || "").trim();
    if (!trimmed) {
      // Clearing — handled separately by the Clear button.
      commitDocOnly(null);
      return;
    }
    if (
      trimmed.toLowerCase() === String(value || "").toLowerCase() &&
      targetEntityId === currentEntityId
    ) {
      // No-op — same name and same entity.
      setEditing(false);
      setQuery("");
      return;
    }
    if (!currentEntityId) {
      // Nothing to "apply to all" against — go straight to doc-only.
      commitDocOnly(trimmed);
      return;
    }
    setPendingChange({ display: trimmed, entityId: targetEntityId });
  };

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter((o: any) => {
        const d = (displayOf(o) || "").toLowerCase();
        const c = (o.canonical_code || "").toLowerCase();
        return d.includes(q) || c.includes(q);
      })
    : options;
  const exactMatch = filtered.some(
    (o: any) => displayOf(o).toLowerCase() === q,
  );
  const canCreate = q.length > 0 && !exactMatch;

  if (editing) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0">
          {label}
        </span>
        <div ref={rootRef} className="relative flex-1">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setEditing(false);
                    setQuery("");
                    setPendingChange(null);
                  }
                  if (e.key === "Enter") {
                    if (filtered.length === 1) {
                      handleCommit(displayOf(filtered[0]), filtered[0].id);
                    } else if (canCreate) {
                      handleCommit(query, null);
                    }
                  }
                }}
                placeholder={`Search ${normType}...`}
                className="w-full h-7 rounded border bg-background pl-7 pr-2 text-sm"
                autoFocus
                disabled={saving}
              />
            </div>
            <ActionButton
              onClick={() => commitDocOnly(null)}
              disabled={saving}
              variant="danger"
              title="Delete this field's saved value"
            >
              Delete
            </ActionButton>
            <IconButton
              label="Close"
              onClick={() => {
                setEditing(false);
                setQuery("");
                setPendingChange(null);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          {/* Dropdown panel */}
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border bg-background shadow-lg">
            {loadingOptions ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Loading...
              </div>
            ) : (
              <>
                {filtered.length === 0 && !canCreate && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No {normType} yet. Type a name to create one.
                  </div>
                )}
                {!pendingChange &&
                  filtered.slice(0, 50).map((opt: any) => {
                    const d = displayOf(opt);
                    const isCurrent =
                      value && d.toLowerCase() === String(value).toLowerCase();
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleCommit(d, opt.id)}
                        disabled={saving}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent ${isCurrent ? "bg-accent/40" : ""}`}
                      >
                        <span className="truncate">{d}</span>
                        {opt.canonical_code && (
                          <span className="text-[10px] font-mono text-muted-foreground truncate">
                            {opt.canonical_code}
                          </span>
                        )}
                      </button>
                    );
                  })}
                {canCreate && !pendingChange && (
                  <button
                    onClick={() => handleCommit(query, null)}
                    disabled={saving}
                    className="flex w-full items-center gap-2 border-t px-3 py-1.5 text-left text-xs text-primary hover:bg-primary/10"
                  >
                    <Plus className="h-3 w-3" />
                    {currentEntityId ? (
                      <>
                        Use{" "}
                        <span className="font-medium">"{query.trim()}"</span>
                      </>
                    ) : (
                      <>
                        Create new:{" "}
                        <span className="font-medium">"{query.trim()}"</span>
                      </>
                    )}
                  </button>
                )}
                {pendingChange && (
                  // Two-button scope confirm. Fires for every change to a
                  // populated field: picking a sibling entry, typing a
                  // new name, anything that's not a no-op or a clear.
                  // The "all documents" path adapts: merge when the user
                  // picked an existing entry, rename when they typed a
                  // brand-new name. Both cascade through joins so every
                  // doc linked to the old entity follows automatically.
                  <div className="border-t bg-muted/30 p-2 space-y-2">
                    <div className="rounded border bg-background px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Change {singular}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-medium break-all">
                          {fromLabel || (
                            <span className="text-muted-foreground italic">
                              (empty)
                            </span>
                          )}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary break-all">
                          {pendingChange.display}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => commitDocOnly(pendingChange.display)}
                        disabled={saving}
                        className="rounded border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent disabled:opacity-50"
                      >
                        <span className="font-medium">Just this document</span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                          Only this document switches to{" "}
                          <span className="font-medium">
                            "{pendingChange.display}"
                          </span>
                          . Other documents labelled{" "}
                          <span className="font-medium">"{fromLabel}"</span>{" "}
                          stay as they are.
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          applyToAllDocuments(
                            pendingChange.display,
                            pendingChange.entityId,
                          )
                        }
                        disabled={saving}
                        className="rounded border border-primary/40 bg-primary/5 px-2 py-1.5 text-left text-xs hover:bg-primary/10 disabled:opacity-50"
                      >
                        <span className="font-medium">
                          Every document with "{fromLabel}"
                        </span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                          {pendingChange.entityId &&
                          pendingChange.entityId !== currentEntityId ? (
                            <>
                              All documents currently labelled{" "}
                              <span className="font-medium">"{fromLabel}"</span>{" "}
                              will be relabelled{" "}
                              <span className="font-medium">
                                "{pendingChange.display}"
                              </span>
                              . The two {normType} are merged. Confirmation
                              required.
                            </>
                          ) : (
                            <>
                              The {singular} record{" "}
                              <span className="font-medium">"{fromLabel}"</span>{" "}
                              is renamed to{" "}
                              <span className="font-medium">
                                "{pendingChange.display}"
                              </span>
                              , so every linked document picks up the new name.
                              Confirmation required.
                            </>
                          )}
                        </span>
                      </button>
                      <button
                        onClick={() => setPendingChange(null)}
                        disabled={saving}
                        className="rounded px-2 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => {
        setQuery("");
        setEditing(true);
      }}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value || (
          <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">
            click to edit
          </span>
        )}
      </span>
    </div>
  );
}
