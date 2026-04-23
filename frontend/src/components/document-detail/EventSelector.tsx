import { useState } from "react";
import api from "@/api/client";
import { Stethoscope } from "lucide-react";
import { Section } from "./DocumentDetailHelpers";
import { useToast } from "@/contexts/ToastContext";
import { useEvents } from "@/hooks/data";

export default function EventSelector({ docId, patientId, currentEventId, onUpdate }: {
  docId: number; patientId: number | null; currentEventId: number | null; onUpdate: (eventId: number) => void;
}) {
  const { toast } = useToast();
  const { data: eventsData, refetch: refetchEvents } = useEvents({
    patientId,
    enabled: !!patientId,
  });
  const events = Array.isArray(eventsData) ? eventsData : [];
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);

  const handleAssign = async (eventId: number) => {
    await api.post(`/events/${eventId}/link`, { document_id: docId });
    onUpdate(eventId);
  };

  const handleSuggest = async () => {
    setSuggesting(true);
    setSuggestion(null);
    try {
      const res = await api.post(`/events/suggest-for-document/${docId}`);
      setSuggestion(res.data);
    } catch { toast({ title: "Failed to get suggestion", variant: "error" }); }
    setSuggesting(false);
  };

  const handleCreateAndLink = async (s: any) => {
    if (!patientId || !s) return;
    const res = await api.post("/events", {
      patient_id: patientId,
      title: s.title,
      event_type: s.event_type || "other",
      description: s.description,
      date_start: s.date_start,
    });
    await api.post(`/events/${res.data.id}/link`, { document_id: docId });
    setSuggestion(null);
    onUpdate(res.data.id);
    refetchEvents();
  };

  if (!patientId) return null;

  const currentEvent = events.find((e) => e.id === currentEventId);

  return (
    <Section title="Medical Event" icon={Stethoscope}>
      {currentEvent ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{currentEvent.title}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{currentEvent.event_type?.replace(/_/g, " ")}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-2">No medical event assigned.</p>
      )}

      <div className="flex flex-wrap gap-2 mt-2">
        <select
          value={currentEventId || ""}
          onChange={(e) => { if (e.target.value) handleAssign(Number(e.target.value)); }}
          className="rounded-md border bg-background px-2 py-1.5 text-xs max-w-full truncate"
          style={{ maxWidth: "min(100%, 20rem)" }}
        >
          <option value="">Assign to event...</option>
          {events.map((ev) => {
            const label = `${ev.title} (${ev.event_type?.replace(/_/g, " ")})`;
            const short = label.length > 60 ? label.slice(0, 57) + "..." : label;
            return <option key={ev.id} value={ev.id}>{short}</option>;
          })}
        </select>

        <button onClick={handleSuggest} disabled={suggesting}
          className="flex items-center gap-1 rounded-md border border-primary/30 px-2 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50">
          {suggesting ? "Analyzing..." : "Suggest (AI)"}
        </button>
      </div>

      {suggestion && (
        <div className="mt-2 rounded-md border p-3 text-xs space-y-2">
          {suggestion.existing_event_id && suggestion.matched_event ? (
            <div>
              <p className="font-medium">Matches: {suggestion.matched_event.title}</p>
              <p className="text-muted-foreground">{suggestion.reason}</p>
              <button onClick={() => handleAssign(suggestion.existing_event_id)}
                className="mt-1 rounded bg-primary px-3 py-1 text-primary-foreground">
                Link to this event
              </button>
            </div>
          ) : suggestion.new_event_suggestion ? (
            <div>
              <p className="font-medium">Suggest new event: {suggestion.new_event_suggestion.title}</p>
              <p className="text-muted-foreground">{suggestion.new_event_suggestion.description}</p>
              <button onClick={() => handleCreateAndLink(suggestion.new_event_suggestion)}
                className="mt-1 rounded bg-primary px-3 py-1 text-primary-foreground">
                Create & Link
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground">No matching event found.</p>
          )}
        </div>
      )}
    </Section>
  );
}
