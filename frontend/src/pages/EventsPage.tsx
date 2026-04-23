import { useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { Plus, Trash2, FileText, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { useEvents } from "@/hooks/data";

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
  const confirm = useConfirm();
  const { data: eventsData, loading, refetch } = useEvents({ patientId: selectedPatient?.id });
  const events = Array.isArray(eventsData) ? eventsData : [];
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [eventDetail, setEventDetail] = useState<any>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [newEvent, setNewEvent] = useState({
    title: "", event_type: "other", description: "",
    date_start: "", date_end: "", is_ongoing: false,
    severity: "", diagnosis_text: "", notes: "",
  });

  const loadEvents = () => refetch();

  const handleCreate = async () => {
    if (!newEvent.title.trim() || !selectedPatient) return;
    await api.post("/events", { ...newEvent, patient_id: selectedPatient.id });
    setShowCreate(false);
    setNewEvent({ title: "", event_type: "other", description: "", date_start: "", date_end: "", is_ongoing: false, severity: "", diagnosis_text: "", notes: "" });
    loadEvents();
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Delete medical event?",
      description: "Documents linked to this event will be unlinked but kept.",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/events/${id}`);
    loadEvents();
  };

  const handleDeleteWithDocs = async (id: number) => {
    const ok = await confirm({
      title: "Delete event + linked documents?",
      description: "The event AND all its linked documents will be permanently deleted. This cannot be undone.",
      confirmText: "Delete everything",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/events/${id}`, { params: { delete_documents: true } });
    loadEvents();
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) { setExpandedId(null); setEventDetail(null); setEditingId(null); setEditData(null); return; }
    setExpandedId(id);
    setEditingId(null);
    setEditData(null);
    const res = await api.get(`/events/${id}`);
    setEventDetail(res.data);
  };

  const startEdit = (event: any) => {
    setEditingId(event.id);
    setEditData({
      title: event.title || "",
      event_type: event.event_type || "other",
      description: event.description || "",
      date_start: event.date_start || "",
      date_end: event.date_end || "",
      is_ongoing: !!event.is_ongoing,
      severity: event.severity || "",
      diagnosis_text: event.diagnosis_text || "",
      notes: event.notes || "",
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData(null);
  };

  const handleUpdate = async () => {
    if (!editingId || !editData?.title?.trim()) return;
    const payload = {
      ...editData,
      date_start: editData.date_start || null,
      date_end: editData.date_end || null,
      severity: editData.severity || null,
      diagnosis_text: editData.diagnosis_text || null,
      description: editData.description || null,
      notes: editData.notes || null,
    };
    await api.patch(`/events/${editingId}`, payload);
    const res = await api.get(`/events/${editingId}`);
    setEventDetail(res.data);
    setEditingId(null);
    setEditData(null);
    loadEvents();
  };

  return (
    <div className="space-y-4">
      {selectedPatient && (
        <div className="flex items-center justify-end">
          <button onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New Event
          </button>
        </div>
      )}

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
                    {!!event.is_ongoing && <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-600">ongoing</span>}
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
                  {editingId === event.id && editData ? (
                    <div className="space-y-3">
                      <h4 className="text-sm font-medium">Edit Event</h4>
                      <div className="grid gap-3 md:grid-cols-2">
                        <input type="text" placeholder="Title" value={editData.title}
                          onChange={(e) => setEditData({ ...editData, title: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm" />
                        <select value={editData.event_type}
                          onChange={(e) => setEditData({ ...editData, event_type: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm">
                          {EVENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                        </select>
                        <input type="date" value={editData.date_start}
                          onChange={(e) => setEditData({ ...editData, date_start: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm" />
                        <input type="date" value={editData.date_end}
                          onChange={(e) => setEditData({ ...editData, date_end: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm" />
                        <input type="text" placeholder="Diagnosis" value={editData.diagnosis_text}
                          onChange={(e) => setEditData({ ...editData, diagnosis_text: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm" />
                        <select value={editData.severity}
                          onChange={(e) => setEditData({ ...editData, severity: e.target.value })}
                          className="rounded-md border bg-background px-3 py-2 text-sm">
                          <option value="">Severity...</option>
                          <option value="mild">Mild</option>
                          <option value="moderate">Moderate</option>
                          <option value="severe">Severe</option>
                          <option value="critical">Critical</option>
                        </select>
                      </div>
                      <textarea placeholder="Description..." value={editData.description}
                        onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} />
                      <textarea placeholder="Notes..." value={editData.notes}
                        onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm" rows={2} />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={editData.is_ongoing}
                          onChange={(e) => setEditData({ ...editData, is_ongoing: e.target.checked })} />
                        Ongoing condition
                      </label>
                      <div className="flex gap-2">
                        <button onClick={handleUpdate}
                          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90">Save</button>
                        <button onClick={cancelEdit}
                          className="rounded-md border px-4 py-2 text-sm">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                  {eventDetail.description && (
                    <p className="text-sm text-muted-foreground">{eventDetail.description}</p>
                  )}
                  {eventDetail.notes && (
                    <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">{eventDetail.notes}</p>
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
                            <span className="text-muted-foreground">{doc.event_date}</span>
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
                    <button onClick={() => startEdit(event)}
                      className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent/30">
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button onClick={() => handleDelete(event.id)}
                      className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950">
                      <Trash2 className="h-3 w-3" /> Delete Event
                    </button>
                    <button onClick={() => handleDeleteWithDocs(event.id)}
                      className="flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs text-white hover:bg-red-700">
                      <Trash2 className="h-3 w-3" /> Delete Event & Documents
                    </button>
                  </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
