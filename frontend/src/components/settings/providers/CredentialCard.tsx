import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Credential } from "@/types";
import AttachedModelRow from "./AttachedModelRow";
import ModelForm from "./ModelForm";
import { iconForType, type AttachedModel, type ModelKind } from "./types";

export interface CredentialCardProps {
  credential: Credential;
  models: AttachedModel[];
  isAddingModel: boolean;
  editingModelKey: string | null;
  busy: boolean;
  onEditCredential: () => void;
  onDeleteCredential: () => void;
  onStartAddModel: () => void;
  onCancelAddModel: () => void;
  onAddModel: (
    kind: ModelKind,
    name: string,
    model: string,
    timeout: number,
  ) => Promise<void>;
  onStartEditModel: (key: string) => void;
  onCancelEditModel: () => void;
  onSaveEditModel: (
    m: AttachedModel,
    name: string,
    model: string,
    timeout: number,
  ) => Promise<void>;
  onToggleModel: (m: AttachedModel) => Promise<void>;
  onRemoveModel: (m: AttachedModel) => Promise<void>;
  onTestModel: (m: AttachedModel) => Promise<{ ok: boolean; message: string }>;
}

export const modelKey = (m: AttachedModel) => `${m.kind}-${m.entry_id}`;

export default function CredentialCard({
  credential: c,
  models,
  isAddingModel,
  editingModelKey,
  busy,
  onEditCredential,
  onDeleteCredential,
  onStartAddModel,
  onCancelAddModel,
  onAddModel,
  onStartEditModel,
  onCancelEditModel,
  onSaveEditModel,
  onToggleModel,
  onRemoveModel,
  onTestModel,
}: CredentialCardProps) {
  const Icon = iconForType(c.type);
  const refs = c.references || {
    llm: 0,
    vision: 0,
    ocr: 0,
    general: 0,
    total: 0,
  };

  return (
    <div className="rounded-lg border overflow-hidden">
      {/* Credential header */}
      <div className="flex items-center gap-3 p-3 bg-card">
        <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{c.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              {c.type}
            </span>
            <span className="text-xs text-muted-foreground">
              max {c.max_concurrent} concurrent · {c.max_retries} retries
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            {c.base_url || (
              <span className="italic opacity-60">no base URL</span>
            )}
            {" · "}
            {c.has_api_key ? "API key ••••••••" : "no API key"}
          </div>
        </div>
        <button
          onClick={onEditCredential}
          className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
          title="Edit provider"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={onDeleteCredential}
          disabled={refs.total > 0 || busy}
          title={
            refs.total > 0
              ? `${refs.total} model(s) attached - remove them first`
              : "Delete provider"
          }
          className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Attached models */}
      <div className="border-t bg-background p-3 space-y-2">
        {models.length === 0 && !isAddingModel && (
          <div className="text-xs text-muted-foreground italic py-1">
            No models attached yet.
          </div>
        )}
        {models.map((m) => {
          const key = modelKey(m);
          if (editingModelKey === key) {
            return (
              <ModelForm
                key={key}
                cred={c}
                initial={m}
                onSubmit={(_kind, name, model, timeout) =>
                  onSaveEditModel(m, name, model, timeout)
                }
                onCancel={onCancelEditModel}
              />
            );
          }
          return (
            <AttachedModelRow
              key={key}
              model={m}
              onToggle={() => onToggleModel(m)}
              onEdit={() => onStartEditModel(key)}
              onRemove={() => onRemoveModel(m)}
              onTest={() => onTestModel(m)}
            />
          );
        })}

        {isAddingModel ? (
          <ModelForm
            cred={c}
            onSubmit={(kind, name, model, timeout) =>
              onAddModel(kind, name, model, timeout)
            }
            onCancel={onCancelAddModel}
          />
        ) : (
          <button
            onClick={onStartAddModel}
            className="inline-flex items-center gap-1 rounded-md border border-dashed px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add model
          </button>
        )}
      </div>
    </div>
  );
}
