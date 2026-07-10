import { useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import {
  Plus,
  Trash2,
  FileText,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import IconButton from "@/components/ui/IconButton";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from "@/components/ui/Menu";
import { EVENT_COLORS } from "./events/constants";
import EventForm from "./events/EventForm";
import { useEventsPage } from "./events/useEventsPage";
import type { LinkedDocument, MedicalEvent, MedicalEventDetail } from "@/types";

export default function EventsPage() {
  const { selectedPatient } = usePatient();
  const confirm = useConfirm();
  const { events, loading, loadEvents } = useEventsPage(selectedPatient);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [eventDetail, setEventDetail] = useState<MedicalEventDetail | null>(
    null,
  );
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<any>(null);
  const [newEvent, setNewEvent] = useState({
    title: "",
    event_type: "other",
    description: "",
    date_start: "",
    date_end: "",
    is_ongoing: false,
    severity: "",
    diagnosis_text: "",
    notes: "",
  });

  const handleCreate = async () => {
    if (!newEvent.title.trim() || !selectedPatient) return;
    await api.post("/events", { ...newEvent, patient_id: selectedPatient.id });
    setShowCreate(false);
    setNewEvent({
      title: "",
      event_type: "other",
      description: "",
      date_start: "",
      date_end: "",
      is_ongoing: false,
      severity: "",
      diagnosis_text: "",
      notes: "",
    });
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
      description:
        "The event AND all its linked documents will be permanently deleted. This cannot be undone.",
      confirmText: "Delete everything",
      variant: "destructive",
    });
    if (!ok) return;
    await api.delete(`/events/${id}`, { params: { delete_documents: true } });
    loadEvents();
  };

  const toggleExpand = async (id: number) => {
    if (expandedId === id) {
      setExpandedId(null);
      setEventDetail(null);
      setEditingId(null);
      setEditData(null);
      return;
    }
    setExpandedId(id);
    setEditingId(null);
    setEditData(null);
    const res = await api.get<MedicalEventDetail>(`/events/${id}`);
    setEventDetail(res.data);
  };

  const startEdit = (event: MedicalEvent) => {
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
    const res = await api.get<MedicalEventDetail>(`/events/${editingId}`);
    setEventDetail(res.data);
    setEditingId(null);
    setEditData(null);
    loadEvents();
  };

  return (
    <div className="space-y-4">
      {selectedPatient && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New Event
          </button>
        </div>
      )}

      {!selectedPatient && (
        <p className="text-muted-foreground">
          Select a patient to view medical events.
        </p>
      )}

      {/* Create form */}
      {showCreate && selectedPatient && (
        <div className="rounded-lg border p-4 space-y-3">
          <EventForm
            mode="create"
            value={newEvent}
            onChange={setNewEvent}
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
          />
        </div>
      )}

      {/* Events list */}
      {loading ? (
        <p className="text-muted-foreground">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground">
          No medical events yet.
          {selectedPatient && " Create one to start organizing documents."}
        </p>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-lg border overflow-hidden">
              <button
                onClick={() => toggleExpand(event.id)}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/30"
              >
                <div
                  className={`h-3 w-3 rounded-full flex-shrink-0 ${EVENT_COLORS[event.event_type] || "bg-gray-500"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{event.title}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {event.event_type.replace(/_/g, " ")}
                    </span>
                    {!!event.is_ongoing && (
                      <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] text-orange-600">
                        ongoing
                      </span>
                    )}
                    {event.severity && (
                      <span className="text-[10px] text-muted-foreground">
                        {event.severity}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
                    {event.date_start && (
                      <span>
                        {event.date_start}
                        {event.date_end ? ` — ${event.date_end}` : ""}
                      </span>
                    )}
                    {event.diagnosis_text && (
                      <span>{event.diagnosis_text}</span>
                    )}
                    <span>{event.document_count || 0} document(s)</span>
                  </div>
                </div>
                {expandedId === event.id ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>

              {expandedId === event.id && eventDetail && (
                <div className="border-t p-4 space-y-3">
                  {editingId === event.id && editData ? (
                    <EventForm
                      mode="edit"
                      value={editData}
                      onChange={setEditData}
                      onSubmit={handleUpdate}
                      onCancel={cancelEdit}
                    />
                  ) : (
                    <>
                      {eventDetail.description && (
                        <p className="text-sm text-muted-foreground">
                          {eventDetail.description}
                        </p>
                      )}
                      {eventDetail.notes && (
                        <p className="text-xs italic text-muted-foreground whitespace-pre-wrap">
                          {eventDetail.notes}
                        </p>
                      )}

                      {/* Linked documents */}
                      <div>
                        <h4 className="text-sm font-medium mb-2">
                          Linked Documents
                        </h4>
                        {eventDetail.documents?.length > 0 ? (
                          <div className="space-y-1">
                            {eventDetail.documents.map((doc: LinkedDocument) => (
                              <Link
                                key={doc.document_id}
                                to={`/documents/${doc.document_id}`}
                                className="flex flex-col gap-0.5 rounded-md border p-2 text-xs hover:bg-accent/30 sm:flex-row sm:items-center sm:gap-2"
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <FileText className="h-3 w-3 flex-shrink-0 text-primary" />
                                  <span className="min-w-0 truncate font-medium">
                                    {doc.original_filename}
                                  </span>
                                  <span className="shrink-0 text-muted-foreground">
                                    {doc.doc_type?.replace(/_/g, " ")}
                                  </span>
                                </span>
                                <span className="flex items-center gap-2 pl-5 sm:pl-0">
                                  <span className="text-muted-foreground">
                                    {doc.event_date}
                                  </span>
                                  {doc.relevance !== "primary" && (
                                    <span className="rounded bg-muted px-1 py-0.5 text-[9px]">
                                      {doc.relevance}
                                    </span>
                                  )}
                                </span>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No documents linked yet.
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => startEdit(event)}
                          className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent/30 coarse:min-h-11"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          onClick={() => handleDelete(event.id)}
                          className="flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive-soft coarse:min-h-11"
                        >
                          <Trash2 className="h-3 w-3" /> Delete Event
                        </button>
                        <Menu>
                          <MenuTrigger asChild>
                            <IconButton
                              label="More actions"
                              variant="secondary"
                              size="sm"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </IconButton>
                          </MenuTrigger>
                          <MenuContent align="start">
                            <MenuItem
                              destructive
                              onSelect={() => handleDeleteWithDocs(event.id)}
                            >
                              <Trash2 className="h-4 w-4" /> Delete Event &
                              Documents
                            </MenuItem>
                          </MenuContent>
                        </Menu>
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
