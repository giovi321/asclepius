import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { Plus, Trash2, FileText, ChevronDown, ChevronUp } from "lucide-react";

const EVENT_TYPES = [
  "symptom", "diagnosis", "hospitalization", "surgery", "treatment",
  "follow_up", "emergency", "pregnancy", "chronic_condition",
  "injury", "screening", "other",
];

const EVENT_COLORS: Record<string, string> = {
  symptom: "bg-yellow-500",
  diagnosis: "bg-red-500",
  hospitalization: "bg-purple-500",
  surgery: "bg-pink-500",
  treatment: "bg-blue-500",
  follow_up: "bg-cyan-500",
  emergency: "bg-red-600",
  pregnancy: "bg-rose-400",
  chronic_condition: "bg-orange-500",
  injury: "bg-amber-500",
  screening: "bg-green-500",
  other: "bg-gray-500",
};

export default function EventsPage() {
  const { selectedPatient } = usePatient();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [eventDetail, setEventDetail] = useState<any>(null);
  const [newEvent, setNewEvent] = useState({
    title: "", event_type: "other", description: "",
    date_start: "", date_end: "", is_ongoing: false,
    severity: "", diagnosis_text: "", notes: "",
  });

  const loadEvents = () => {
    setLoading(true);
    const params: Record<string, any> = {};
    if (selectedPatient) params.patient_id = selectedPatient.id;
    api.get("/events", { params })
      .then((res) => setEvents(res.data || []))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadEvents(); }, [selectedPatient]);

  const handleCreate = async () => {
    if (!newEvent.title.trim() || !selectedPatient) return;
    await api.post("/events", { ...newEvent, patient_id: selectedPatient.id });
    setShowCreate(false);
    setNewEvent({ title: "", event_type: "other", description: "", date_start: "", date_end: "", is_ongoing: false, severity: "", diagnosis_text: "", notes: "" });
    loadEvents();
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this medical event? Documents will be unlinked but kept.")) return;
    await api.delete(`/events/${id}`);
    loadEvents();
  };

  const handleDeleteWithDocs = async (id: number) => {
    if (!confirm("Delete this medical event AND all its linked documents? This cannot be undone.")) return;
    await api.delete(`/events/${id}`, { params: { delete_documents: true } });
    loadEvents();
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setEventDetail(null); return; }
    setExpandedId(id);
    const res = await api.get(`/events/${id}`);
    setEventDetail(res.data);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Medical Events</h1>
        {selectedPatient && (
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New Event
          </button>
        )}
      </div>

      {!selectedPatient && (
        <p className="text-muted-foreground">Select a patient to view medical events.</p>
      )}

      {/* Create form */}
      {showCreate && selectedPatient && (
        <div className="rounded-lg border p-4 space-y-3">
          <h3 className="font-medium">New Medical Event</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <input type="text" placeholder="Title (e.g. Sleep Apnea Treatment)" value={newEvent.title}
              onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
            <select value={newEvent.event_type} onChange={(e) => setNewEvent({ ...newEvent, event_type: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm">
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
            <input type="date" placeholder="Start date" value={newEvent.date_start}
              onChange={(e) => setNewEvent({ ...newEvent, date_start: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="date" placeholder="End date" value={newEvent.date_end}
              onChange={(e) => setNewEvent({ ...newEvent, date_end: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
            <input type="text" placeholder="Diagnosis" value={newEvent.diagnosis_text}
              onChange={(e) => setNewEvent({ ...newEvent, diagnosis_text: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm" />
            <select value={newEvent.severity || ""} onChange={(e) => setNewEvent({ ...newEvent, severity: e.target.value })}
              className="rounded-md border bg-background px-3 py-2 text-sm">
              <option value="">Severity...</option>
              <option value="mild">Mild</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <textarea placeholder="Description..." value={newEvent.description}
            onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={newEvent.is_ongoing}
              onChange={(e) => setNewEvent({ ...newEvent, is_ongoing: e.target.checked })} />
            Ongoing condition
          </label>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create</button>
            <button onClick={() => setShowCreate(false)} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Events list */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground">No medical events yet.{selectedPatient && " Create one to start organizing documents."}</p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border overflow-hidden">
              <button onClick={() => toggleExpand(event.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/30">
                <div className={`h-3 w-3 rounded-full flex-shrink-0 ${EVENT_COLORS[event.event_type] || "bg-gray-500"}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{event.title}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">{event.event_type.replace(/_/g, " ")}</span>
                    {event.is_ongoing && <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-600">ongoing</span>}
                    {event.severity && <span className="text-[10px] text-muted-foreground">{event.severity}</span>}
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                    {event.date_start && <span>{event.date_start}{event.date_end ? ` — ${event.date_end}` : ""}</span>}
                    {event.diagnosis_text && <span>{event.diagnosis_text}</span>}
                    <span>{event.document_count || 0} document(s)</span>
                  </div>
                </div>
                {expandedId === event.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>

              {expandedId === event.id && eventDetail && (
                <div className="border-t p-4 space-y-3">
                  {eventDetail.description && (
                    <p className="text-sm text-muted-foreground">{eventDetail.description}</p>
                  )}

                  {/* Linked documents */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">Linked Documents</h4>
                    {eventDetail.documents?.length > 0 ? (
                      <div className="space-y-1">
                        {eventDetail.documents.map((doc: any) => (
                          <Link key={doc.document_id} to={`/documents/${doc.document_id}`}
                            className="flex items-center gap-2 rounded-md border p-2 text-xs hover:bg-accent/30">
                            <FileText className="h-3 w-3 flex-shrink-0 text-primary" />
                            <span className="font-medium truncate">{doc.original_filename}</span>
                            <span className="text-muted-foreground">{doc.doc_type?.replace(/_/g, " ")}</span>
                            <span className="text-muted-foreground">{doc.doc_date}</span>
                            {doc.relevance !== "primary" && (
                              <span className="rounded bg-muted px-1 py-0.5 text-[9px]">{doc.relevance}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No documents linked yet.</p>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => handleDelete(event.id)}
                      className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">
                      <Trash2 className="h-3 w-3" /> Delete Event
                    </button>
                    <button onClick={() => handleDeleteWithDocs(event.id)}
                      className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700">
                      <Trash2 className="h-3 w-3" /> Delete Event & Documents
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
