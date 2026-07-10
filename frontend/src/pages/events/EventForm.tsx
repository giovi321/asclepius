import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { EVENT_TYPES } from "./constants";

export interface EventFormData {
  title: string;
  event_type: string;
  description: string;
  date_start: string;
  date_end: string;
  is_ongoing: boolean;
  severity: string;
  diagnosis_text: string;
  notes: string;
}

export interface EventFormProps {
  mode: "create" | "edit";
  value: EventFormData;
  onChange: (next: EventFormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Shared create/edit form for medical events. The two call sites used to
 * inline near-duplicated JSX; this renders the same fields verbatim and
 * branches on ``mode`` only where the original markup actually differed
 * (heading, title placeholder, the end-date helper label, the presence of
 * the notes field, and the submit-button label/style).
 */
export default function EventForm({
  mode,
  value,
  onChange,
  onSubmit,
  onCancel,
}: EventFormProps) {
  const set = (patch: Partial<EventFormData>) =>
    onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      {mode === "create" ? (
        <h3 className="font-medium">New Medical Event</h3>
      ) : (
        <h4 className="text-sm font-medium">Edit Event</h4>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Input
          type="text"
          placeholder={
            mode === "create" ? "Title (e.g. Sleep Apnea Treatment)" : "Title"
          }
          value={value.title}
          onChange={(e) => set({ title: e.target.value })}
        />
        <Select
          value={value.event_type}
          onChange={(e) => set({ event_type: e.target.value })}
        >
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
        {mode === "create" ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Start date
              <Input
                type="date"
                value={value.date_start}
                onChange={(e) => set({ date_start: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              End date{" "}
              <span className="text-muted-foreground/70">
                (leave empty if ongoing)
              </span>
              <Input
                type="date"
                value={value.date_end}
                onChange={(e) => set({ date_end: e.target.value })}
              />
            </label>
          </>
        ) : (
          <>
            <Input
              type="date"
              value={value.date_start}
              onChange={(e) => set({ date_start: e.target.value })}
            />
            <Input
              type="date"
              value={value.date_end}
              onChange={(e) => set({ date_end: e.target.value })}
            />
          </>
        )}
        <Input
          type="text"
          placeholder="Diagnosis"
          value={value.diagnosis_text}
          onChange={(e) => set({ diagnosis_text: e.target.value })}
        />
        <Select
          value={value.severity || ""}
          onChange={(e) => set({ severity: e.target.value })}
        >
          <option value="">Severity...</option>
          <option value="mild">Mild</option>
          <option value="moderate">Moderate</option>
          <option value="severe">Severe</option>
          <option value="critical">Critical</option>
        </Select>
      </div>
      <Textarea
        placeholder="Description..."
        value={value.description}
        onChange={(e) => set({ description: e.target.value })}
        rows={2}
        className="min-h-0"
      />
      {mode === "edit" && (
        <Textarea
          placeholder="Notes..."
          value={value.notes}
          onChange={(e) => set({ notes: e.target.value })}
          rows={2}
          className="min-h-0"
        />
      )}
      <label className="flex min-h-6 items-center gap-2 text-sm coarse:min-h-11">
        <input
          type="checkbox"
          checked={value.is_ongoing}
          onChange={(e) => set({ is_ongoing: e.target.checked })}
          className="h-4 w-4 accent-primary"
        />
        Ongoing condition
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="md" onClick={onSubmit}>
          {mode === "create" ? "Create" : "Save"}
        </Button>
        <Button variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
