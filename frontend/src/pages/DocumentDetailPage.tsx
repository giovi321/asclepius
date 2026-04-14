import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api/client";
import {
  RefreshCw, FileText, TestTube, Pill, Syringe, Stethoscope, Download,
  Eye, EyeOff, Trash2, Plus, X, Link2, Search,
} from "lucide-react";
import PdfViewer from "@/components/PdfViewer";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [relevantDocs, setRelevantDocs] = useState<any[]>([]);
  const [loadingRelevant, setLoadingRelevant] = useState(false);
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkType, setLinkType] = useState("related");

  const loadDoc = async (showLoading = true) => {
    const scrollY = window.scrollY;
    if (showLoading && !doc) setLoading(true);
    const res = await api.get(`/documents/${id}`);
    setDoc(res.data);
    setNotes(res.data.user_notes || "");
    setLinkedDocs(res.data.links || []);
    setLoading(false);
    if (!showLoading) requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  useEffect(() => {
    loadDoc();
  }, [id]);

  const [aiInstruction, setAiInstruction] = useState("");
  const [aiEditing, setAiEditing] = useState(false);

  // Lightweight doc update — merges new fields without full reload (preserves scroll)
  const updateDocFields = (updated?: any) => {
    if (updated) setDoc((prev: any) => ({ ...prev, ...updated }));
  };

  const handleReprocess = async () => {
    await api.post(`/documents/${id}/reprocess`);
    await loadDoc(false);
  };

  const handleAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setAiEditing(true);
    try {
      await api.post(`/documents/${id}/edit-with-ai`, { instruction: aiInstruction });
      setAiInstruction("");
      await loadDoc(false);
    } catch (e: any) {
      alert("AI edit failed: " + (e.response?.data?.detail || e.message));
    } finally {
      setAiEditing(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api.post(`/documents/${id}/cancel`);
      await loadDoc();
    } catch {
      alert("Failed to cancel processing");
    }
  };

  const handleRotate = async (degrees: number, pages: number[] | null) => {
    try {
      await api.post(`/documents/${id}/rotate`, { degrees, pages });
      await loadDoc(false);
    } catch (e: any) {
      console.error("Rotate failed:", e);
      alert("Rotation failed: " + (e.response?.data?.detail || e.message));
      throw e; // Re-throw so PdfViewer knows it failed
    }
  };

  // Auto-refresh while processing
  useEffect(() => {
    if (doc?.status === "processing" || doc?.status === "pending") {
      const interval = setInterval(loadDoc, 3000);
      return () => clearInterval(interval);
    }
  }, [doc?.status]);

  // Load relevant document suggestions
  useEffect(() => {
    if (!doc?.patient_id || !doc?.id) return;
    setLoadingRelevant(true);
    api.get(`/documents/${doc.id}/relevant`)
      .then((res) => setRelevantDocs(res.data.suggestions || []))
      .catch(() => {})
      .finally(() => setLoadingRelevant(false));
  }, [doc?.id, doc?.patient_id]);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) return;
    try {
      await api.delete(`/documents/${id}`);
      navigate("/documents");
    } catch {
      alert("Failed to delete document");
    }
  };

  const handleSaveNotes = async () => {
    try {
      await api.patch(`/documents/${id}`, { user_notes: notes });
      setEditingNotes(false);
    } catch {
      alert("Failed to save notes");
    }
  };

  // IDs of documents already linked (both directions)
  const alreadyLinkedIds = new Set(
    linkedDocs.flatMap((l: any) => [l.source_document_id, l.target_document_id])
  );
  alreadyLinkedIds.add(Number(id)); // exclude self

  const filterLinked = (docs: any[]) =>
    docs.filter((d: any) => !alreadyLinkedIds.has(d.id));

  const handleSearchLink = async () => {
    if (!linkSearch.trim()) {
      try {
        const res = await api.get("/documents", { params: { limit: 30 } });
        setLinkResults(filterLinked(res.data.items || []));
      } catch { setLinkResults([]); }
      return;
    }
    try {
      const res = await api.get("/documents", { params: { q: linkSearch, limit: 30 } });
      let results = filterLinked(res.data.items || []);

      if (results.length === 0) {
        const allRes = await api.get("/documents", { params: { limit: 100 } });
        const all = allRes.data.items || [];
        const term = linkSearch.toLowerCase();
        results = filterLinked(all.filter((d: any) =>
          d.original_filename?.toLowerCase().includes(term) ||
          d.doc_type?.toLowerCase().includes(term) ||
          d.doctor_name?.toLowerCase().includes(term) ||
          d.facility_name?.toLowerCase().includes(term) ||
          d.summary_en?.toLowerCase().includes(term) ||
          d.patient_name?.toLowerCase().includes(term)
        )).slice(0, 20);
      }

      setLinkResults(results);
    } catch {
      setLinkResults([]);
    }
  };

  const handleLinkDocument = async (targetId: number) => {
    const scrollY = window.scrollY;
    try {
      const res = await api.post(`/documents/${id}/link`, { target_document_id: targetId, link_type: linkType });
      const linked = linkResults.find((d: any) => d.id === targetId);
      setLinkedDocs((prev) => [...prev, {
        ...res.data,
        target_filename: linked?.original_filename,
        target_doc_type: linked?.doc_type,
      }]);
      setLinkResults((prev) => prev.filter((d: any) => d.id !== targetId));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        alert(detail || "These documents are already linked");
        setLinkResults((prev) => prev.filter((d: any) => d.id !== targetId));
      } else {
        alert(detail || "Failed to link document");
      }
    }
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!doc) return <div className="text-destructive">Document not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <EditableFilename value={doc.original_filename} docId={doc.id} onSave={updateDocFields} />
          <p className="text-sm text-muted-foreground">
            {doc.doc_type?.replace(/_/g, " ")} | {doc.date_visit || doc.date_issued || doc.doc_date || "No date"} | {doc.patient_name || "Unclassified"}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/documents/${id}/file`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            <FileText className="h-4 w-4" /> View file
          </a>
          {(doc.status === "processing" || doc.status === "pending") && (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1 rounded-md border border-yellow-300 px-3 py-1.5 text-sm text-yellow-600 hover:bg-yellow-50 dark:border-yellow-800 dark:hover:bg-yellow-950"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          )}
          {doc.status !== "processing" && (
            <button
              onClick={handleReprocess}
              className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
            >
              <RefreshCw className="h-4 w-4" /> Reprocess
            </button>
          )}
          <button
            onClick={handleDelete}
            className="flex items-center gap-1 rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
          >
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        </div>
      </div>

      {/* Summary */}
      <EditableSummary value={doc.summary_en} docId={doc.id} onSave={updateDocFields} />

      {doc.sections?.length > 0 && (
        <div className="rounded-lg border p-4">
          <h3 className="mb-3 font-medium">Document Sections ({doc.sections.length})</h3>
          <div className="space-y-2">
            {doc.sections.map((section: any) => (
              <div key={section.id} className="flex items-center gap-3 text-sm rounded-md border p-2">
                <span className="text-xs text-muted-foreground w-16">
                  pp. {section.page_start}{"\u2013"}{section.page_end}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getSectionTypeStyle(section.section_type)}`}>
                  {section.section_type?.replace(/_/g, " ")}
                </span>
                {section.summary_en && (
                  <span className="flex-1 text-xs text-muted-foreground truncate">{section.summary_en}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Document viewer */}
        <div className="space-y-4">
          {(doc.file_path?.toLowerCase().endsWith(".pdf") || doc.original_filename?.toLowerCase().endsWith(".pdf")) ? (
            <div className="rounded-lg border overflow-hidden h-[700px]">
              <PdfViewer key={`pdf-${id}`} url={`/api/documents/${id}/file`} onRotate={handleRotate} />
            </div>
          ) : doc.file_path?.match(/\.(jpg|jpeg|png|tiff|tif)$/i) ? (
            <div className="rounded-lg border overflow-hidden">
              <img
                src={`/api/documents/${id}/file`}
                alt={doc.original_filename}
                className="w-full object-contain max-h-[700px]"
              />
            </div>
          ) : (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-2" />
              <p>Preview not available for this file type</p>
              <a
                href={`/api/documents/${id}/file`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-sm text-primary hover:underline"
              >
                <Download className="h-4 w-4" /> Download file
              </a>
            </div>
          )}
        </div>

        {/* Extracted data */}
        <div className="space-y-4">
          <Section title="Document Info">
            <InfoRow label="Status" value={doc.status} />
            {(doc.status === "failed" || doc.status === "needs_review") && doc.error_message && (
              <div className="rounded-md bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800 p-3 space-y-1.5">
                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                  {doc.status === "failed" ? "Processing Error" : "Review Required"}
                  {doc.retry_count > 0 && (
                    <span className="font-normal ml-2 text-red-500">({doc.retry_count} retries)</span>
                  )}
                </p>
                <pre className="text-xs text-red-600 dark:text-red-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {doc.error_message}
                </pre>
              </div>
            )}
            <EditableField label="Type" value={doc.doc_type} field="doc_type" docId={doc.id} onSave={updateDocFields} />
            <EditableField label="Date of Visit" value={doc.date_visit} field="date_visit" type="date" docId={doc.id} onSave={updateDocFields} />
            <EditableField label="Date Issued" value={doc.date_issued} field="date_issued" type="date" docId={doc.id} onSave={updateDocFields} />
            <EditableField label="Doctor" value={doc.doctor_name} field="doctor_name" docId={doc.id} onSave={updateDocFields} />
            <EditableField label="Facility" value={doc.facility_name} field="facility_name" docId={doc.id} onSave={updateDocFields} />
            <EditableField label="Specialty" value={doc.specialty_original} field="specialty_original" docId={doc.id} onSave={updateDocFields} />
            <InfoRow label="Language" value={doc.language_source} />
            <InfoRow label="OCR Engine" value={doc.ocr_engine} />
            <InfoRow label="OCR Confidence" value={doc.ocr_confidence?.toFixed(2)} />
          </Section>

          {/* Medical Event */}
          <EventSelector docId={doc.id} patientId={doc.patient_id} currentEventId={doc.event_id} onUpdate={(eventId) => {
            setDoc((prev: any) => ({ ...prev, event_id: eventId }));
          }} />

          {/* Lab Results */}
          {doc.lab_results?.length > 0 && (
            <Section title="Lab Results" icon={TestTube}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="py-1 text-left font-medium">Test</th>
                    <th className="py-1 text-left font-medium">Value</th>
                    <th className="py-1 text-left font-medium">Unit</th>
                    <th className="py-1 text-left font-medium">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {doc.lab_results.map((lr: any) => (
                    <tr key={lr.id} className={lr.is_abnormal ? "text-red-600" : ""}>
                      <td className="py-1">{lr.test_name_original}</td>
                      <td className="py-1 font-medium">{lr.value ?? lr.value_text ?? "\u2014"}</td>
                      <td className="py-1">{lr.unit || ""}</td>
                      <td className="py-1 text-muted-foreground">
                        {lr.reference_range_low != null && lr.reference_range_high != null
                          ? `${lr.reference_range_low}\u2013${lr.reference_range_high}`
                          : "\u2014"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* Encounters */}
          {doc.encounters?.length > 0 && (
            <Section title="Encounters" icon={Stethoscope}>
              {doc.encounters.map((enc: any) => (
                <div key={enc.id} className="space-y-1 text-sm">
                  <InfoRow label="Date" value={enc.encounter_date} />
                  <InfoRow label="Diagnosis" value={enc.diagnosis_original} />
                  <InfoRow label="ICD-10" value={enc.diagnosis_code} />
                  {enc.findings && <p className="text-muted-foreground">{enc.findings}</p>}
                  {enc.notes && <p className="text-muted-foreground">{enc.notes}</p>}
                </div>
              ))}
            </Section>
          )}

          {/* Medications - proper table */}
          {doc.medications?.length > 0 && (
            <Section title="Medications" icon={Pill}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-1 pr-2 text-left font-medium">Medication</th>
                      <th className="py-1 pr-2 text-left font-medium">Dosage</th>
                      <th className="py-1 pr-2 text-left font-medium">Form</th>
                      <th className="py-1 pr-2 text-left font-medium">Frequency</th>
                      <th className="py-1 pr-2 text-left font-medium">Duration</th>
                      <th className="py-1 pr-2 text-left font-medium">Qty</th>
                      <th className="py-1 text-left font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {doc.medications.map((med: any) => (
                      <tr key={med.id}>
                        <td className="py-1 pr-2 font-medium">
                          {med.active_ingredient_original || med.brand_name || "\u2014"}
                        </td>
                        <td className="py-1 pr-2 text-muted-foreground">{med.dosage || "\u2014"}</td>
                        <td className="py-1 pr-2">
                          <MedFormBadge form={med.form} />
                        </td>
                        <td className="py-1 pr-2 text-muted-foreground">{med.frequency || "\u2014"}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{med.duration || "\u2014"}</td>
                        <td className="py-1 pr-2 text-muted-foreground">{med.quantity || "\u2014"}</td>
                        <td className="py-1 text-muted-foreground">{med.date_prescribed || med.start_date || "\u2014"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Vaccinations */}
          {doc.vaccinations?.length > 0 && (
            <Section title="Vaccinations" icon={Syringe}>
              {doc.vaccinations.map((vax: any) => (
                <div key={vax.id} className="text-sm">
                  <span className="font-medium">{vax.vaccine_name}</span>
                  {vax.date_administered && <span className="text-muted-foreground"> \u2014 {vax.date_administered}</span>}
                  {vax.dose_number && <span className="text-muted-foreground"> (dose {vax.dose_number})</span>}
                </div>
              ))}
            </Section>
          )}

          {/* Notes */}
          <Section title="Notes">
            {editingNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={4}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNotes}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setEditingNotes(false); setNotes(doc.user_notes || ""); }}
                    className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => setEditingNotes(true)}
                className="cursor-pointer rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-accent/50 min-h-[60px]"
              >
                {notes || "Click to add notes..."}
              </div>
            )}
          </Section>

          {/* AI Edit */}
          <Section title="AI Edit" icon={Stethoscope}>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiInstruction}
                  onChange={(e) => setAiInstruction(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAiEdit()}
                  placeholder='e.g. "doctor is Dr. Bianchi", "type is invoice", "date 15/03/2024"'
                  className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
                  disabled={aiEditing}
                />
                <button
                  onClick={handleAiEdit}
                  disabled={aiEditing || !aiInstruction.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50"
                >
                  {aiEditing ? "..." : "Apply"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Tell the AI what to change. Press Enter or click Apply.
              </p>
            </div>
          </Section>

          {/* Linked Documents */}
          <Section title="Linked Documents" icon={Link2}>
            {linkedDocs.length > 0 ? (
              <div className="space-y-2">
                {linkedDocs.map((link: any) => {
                  const linkedId = link.source_document_id === Number(id) ? link.target_document_id : link.source_document_id;
                  const linkedName = link.source_document_id === Number(id)
                    ? (link.target_filename || `Document #${link.target_document_id}`)
                    : (link.source_filename || `Document #${link.source_document_id}`);
                  return (
                    <div key={link.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                      <a
                        href={`/documents/${linkedId}`}
                        className="text-primary hover:underline truncate flex-1"
                      >
                        {linkedName}
                      </a>
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {link.link_type || "related"}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            await api.delete(`/documents/${id}/links/${link.id}`);
                            setLinkedDocs((prev) => prev.filter((l: any) => l.id !== link.id));
                          } catch { alert("Failed to remove link"); }
                        }}
                        className="ml-2 rounded p-1 text-muted-foreground hover:text-destructive"
                        title="Remove link"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked documents</p>
            )}
            {/* Relevant Documents (AI suggested) */}
            {(relevantDocs.length > 0 || loadingRelevant) && (
              <div className="mt-3 pt-3 border-t">
                <h4 className="text-xs font-medium text-muted-foreground mb-2">Suggested by AI</h4>
                {loadingRelevant ? (
                  <p className="text-xs text-muted-foreground">Analyzing document relationships...</p>
                ) : (
                  <div className="space-y-2">
                    {relevantDocs.map((sg: any) => (
                      <div key={sg.document_id} className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
                        <div className="flex-1 min-w-0">
                          <a href={`/documents/${sg.document_id}`} className="text-primary hover:underline block truncate font-medium">
                            {sg.filename || `Document #${sg.document_id}`}
                          </a>
                          <span className="text-muted-foreground">
                            {sg.doc_type?.replace(/_/g, " ")} | {sg.doc_date || "no date"}
                          </span>
                          {sg.reason && <p className="text-muted-foreground italic mt-0.5">{sg.reason}</p>}
                        </div>
                        <button
                          onClick={async () => {
                            const scrollY = window.scrollY;
                            try {
                              const res = await api.post(`/documents/${doc.id}/link`, { target_document_id: sg.document_id, link_type: sg.link_type || "related" });
                              setLinkedDocs((prev) => [...prev, { ...res.data, target_filename: sg.filename, target_doc_type: sg.doc_type }]);
                              setRelevantDocs((prev) => prev.filter((r) => r.document_id !== sg.document_id));
                            } catch (e: any) {
                              if (e?.response?.status === 409) {
                                setRelevantDocs((prev) => prev.filter((r) => r.document_id !== sg.document_id));
                              } else {
                                alert("Failed to link: " + (e.response?.data?.detail || e.message));
                              }
                            }
                            requestAnimationFrame(() => window.scrollTo(0, scrollY));
                          }}
                          className="rounded bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20 whitespace-nowrap"
                        >
                          Link
                        </button>
                        <button
                          onClick={() => setRelevantDocs((prev) => prev.filter((r) => r.document_id !== sg.document_id))}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!showLinkSearch ? (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setShowLinkSearch(true); setLinkSearch(""); handleSearchLink(); }}
                  className="flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> Link manually
                </button>
                <SuggestLinksButton docId={doc.id} onLink={(newLink) => {
                  if (newLink) setLinkedDocs((prev) => [...prev, newLink]);
                }} />
              </div>
            ) : (
              <div className="mt-2 space-y-2 rounded-md border p-3">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
                    <input
                      type="text"
                      value={linkSearch}
                      onChange={(e) => setLinkSearch(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearchLink()}
                      placeholder="Search documents..."
                      className="w-full rounded-md border bg-background pl-7 pr-2 py-1.5 text-xs"
                      autoFocus
                    />
                  </div>
                  <select
                    value={linkType}
                    onChange={(e) => setLinkType(e.target.value)}
                    className="rounded-md border bg-background px-2 py-1.5 text-xs"
                  >
                    <option value="related">Related</option>
                    <option value="invoice_for">Invoice for</option>
                    <option value="report_for">Report for</option>
                    <option value="imaging_for">Imaging for</option>
                    <option value="follow_up">Follow-up</option>
                  </select>
                  <button
                    onClick={handleSearchLink}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                  >
                    Search
                  </button>
                  <button
                    onClick={() => { setShowLinkSearch(false); setLinkSearch(""); setLinkResults([]); }}
                    className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {linkResults.length > 0 && (
                  <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
                    {linkResults.filter((d: any) => !alreadyLinkedIds.has(d.id)).map((d: any) => (
                      <div key={d.id} className="group relative">
                        <button
                          onClick={() => handleLinkDocument(d.id)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                        >
                          <FileText className="h-3 w-3 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="block truncate font-medium">{d.original_filename}</span>
                            <span className="block text-muted-foreground">
                              {d.doc_type?.replace(/_/g, " ") || "—"} | {d.doc_date || "no date"}
                              {d.doctor_name && ` | ${d.doctor_name}`}
                              {d.facility_name && ` | ${d.facility_name}`}
                            </span>
                            {d.summary_en && (
                              <span className="block text-muted-foreground truncate">{d.summary_en}</span>
                            )}
                          </div>
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-primary text-[10px] whitespace-nowrap">
                            Link
                          </span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        </div>
      </div>

      {/* OCR Text */}
      <OcrSection text={doc.ocr_text} />
    </div>
  );
}

function getSectionTypeStyle(type: string): string {
  const styles: Record<string, string> = {
    lab_results_page: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    clinical_notes: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    nursing_notes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
    vital_signs: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    consent_form: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    cover_page: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
    medication_chart: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    operative_notes: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    discharge_summary: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    imaging_report: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
    correspondence: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
    invoice_page: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };
  return styles[type] || "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
}

function MedFormBadge({ form }: { form?: string }) {
  if (!form) return <span className="text-muted-foreground">{"\u2014"}</span>;
  const lower = form.toLowerCase();
  let color = "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  let Icon: any = Pill;

  if (lower.includes("tablet") || lower.includes("pill") || lower.includes("capsule")) {
    color = "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300";
    Icon = Pill;
  } else if (lower.includes("inject") || lower.includes("iv") || lower.includes("syringe")) {
    color = "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300";
    Icon = Syringe;
  } else if (lower.includes("cream") || lower.includes("ointment") || lower.includes("topical")) {
    color = "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300";
  } else if (lower.includes("liquid") || lower.includes("syrup") || lower.includes("solution")) {
    color = "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300";
  } else if (lower.includes("inhaler") || lower.includes("spray") || lower.includes("nasal")) {
    color = "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300";
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      <Icon className="h-3 w-3" />
      {form}
    </span>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: any; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-3 flex items-center gap-2 font-medium">
        {Icon && <Icon className="h-4 w-4" />}
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function OcrSection({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded-lg border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 hover:bg-accent/50"
      >
        <h3 className="flex items-center gap-2 font-medium">
          {open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          OCR Text
        </h3>
        <span className="text-xs text-muted-foreground">
          {open ? "Hide" : "Show"} ({text.length} chars)
        </span>
      </button>
      {open && (
        <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap border-t bg-muted/30 p-4 text-xs">
          {text}
        </pre>
      )}
    </div>
  );
}

function SuggestLinksButton({ docId, onLink }: { docId: number; onLink: (newLink?: any) => void }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[] | null>(null);

  const handleSuggest = async () => {
    setLoading(true);
    setSuggestions(null);
    try {
      const res = await api.post(`/documents/${docId}/suggest-links`);
      setSuggestions(res.data.suggestions || []);
    } catch {
      alert("Failed to get suggestions");
    }
    setLoading(false);
  };

  const handleAccept = async (targetId: number, linkType: string) => {
    try {
      const res = await api.post(`/documents/${docId}/link`, { target_document_id: targetId, link_type: linkType });
      setSuggestions((s) => s?.filter((sg) => sg.document_id !== targetId) || null);
      const sg = suggestions?.find((s) => s.document_id === targetId);
      onLink({
        ...res.data,
        target_filename: sg?.filename,
        target_doc_type: sg?.doc_type,
      });
    } catch {
      alert("Failed to link");
    }
  };

  return (
    <div>
      <button
        onClick={handleSuggest}
        disabled={loading}
        className="flex items-center gap-1 rounded-md border border-primary/30 px-3 py-1.5 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
      >
        {loading ? (
          <>
            <div className="animate-spin h-3 w-3 border border-primary border-t-transparent rounded-full" />
            Analyzing...
          </>
        ) : (
          <>
            <Stethoscope className="h-3 w-3" /> Suggest links (AI)
          </>
        )}
      </button>

      {suggestions !== null && (
        <div className="mt-2 space-y-2">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No related documents found</p>
          ) : (
            suggestions.map((sg: any) => (
              <div key={sg.document_id} className="rounded-md border p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <a href={`/documents/${sg.document_id}`} className="font-medium text-primary hover:underline block truncate">
                      {sg.filename || `Document #${sg.document_id}`}
                    </a>
                    <div className="flex flex-wrap gap-2 mt-1 text-muted-foreground">
                      {sg.doc_type && <span className="rounded bg-muted px-1.5 py-0.5">{sg.doc_type.replace(/_/g, " ")}</span>}
                      {sg.doc_date && <span>{sg.doc_date}</span>}
                      {sg.doctor_name && <span>{sg.doctor_name}</span>}
                      {sg.facility_name && <span>{sg.facility_name}</span>}
                    </div>
                    {sg.summary_en && (
                      <p className="mt-1 text-muted-foreground line-clamp-2">{sg.summary_en}</p>
                    )}
                  </div>
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary text-[10px] whitespace-nowrap">
                    {sg.link_type?.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <p className="flex-1 text-muted-foreground italic">{sg.reason}</p>
                  <button
                    onClick={() => handleAccept(sg.document_id, sg.link_type)}
                    className="rounded bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90"
                  >
                    Link
                  </button>
                  <button
                    onClick={() => setSuggestions((s) => s?.filter((x) => x.document_id !== sg.document_id) || null)}
                    className="rounded border px-3 py-1 hover:bg-accent"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EventSelector({ docId, patientId, currentEventId, onUpdate }: {
  docId: number; patientId: number | null; currentEventId: number | null; onUpdate: (eventId: number) => void;
}) {
  const [events, setEvents] = useState<any[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestion, setSuggestion] = useState<any>(null);

  useEffect(() => {
    if (!patientId) return;
    api.get("/events", { params: { patient_id: patientId } })
      .then((res) => setEvents(res.data || []))
      .catch(() => {});
  }, [patientId]);

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
    } catch { alert("Failed to get suggestion"); }
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
    // Reload events list
    api.get("/events", { params: { patient_id: patientId } })
      .then((r) => setEvents(r.data || []));
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
          className="rounded-md border bg-background px-2 py-1.5 text-xs"
        >
          <option value="">Assign to event...</option>
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>{ev.title} ({ev.event_type?.replace(/_/g, " ")})</option>
          ))}
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

function EditableField({ label, value, field, docId, onSave, type = "text", multiline = false }: {
  label: string; value: any; field: string; docId: number; onSave: (updated?: any) => void;
  type?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { [field]: val || null });
      setEditing(false);
      // Pass updated doc back so parent can update state without full reload
      onSave(res.data);
    } catch { alert("Failed to save"); }
    setSaving(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !multiline) handleSave();
    if (e.key === "Escape") { setEditing(false); setVal(value || ""); }
  };

  if (editing) {
    return (
      <div className="flex items-start gap-2 text-sm py-0.5">
        <span className="text-muted-foreground w-28 flex-shrink-0 pt-1">{label}</span>
        <div className="flex-1 flex gap-1">
          {multiline ? (
            <textarea value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={handleKeyDown}
              className="flex-1 rounded border bg-background px-2 py-1 text-sm" rows={2} autoFocus disabled={saving} />
          ) : (
            <input type={type} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={handleKeyDown}
              className="flex-1 rounded border bg-background px-2 py-1 text-sm" autoFocus disabled={saving} />
          )}
          <button onClick={handleSave} disabled={saving}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50">
            {saving ? "..." : "OK"}
          </button>
          <button onClick={() => { setEditing(false); setVal(value || ""); }}
            className="rounded border px-2 py-1 text-xs">
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-between text-sm py-0.5 group cursor-pointer hover:bg-accent/30 rounded px-1 -mx-1"
      onClick={() => { setVal(value || ""); setEditing(true); }}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">
        {value || <span className="text-muted-foreground/50 italic group-hover:text-primary text-xs">click to edit</span>}
      </span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function EditableSummary({ value, docId, onSave }: { value: string | null; docId: number; onSave: (updated?: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setVal(value || ""); }, [value]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.patch(`/documents/${docId}`, { summary_en: val || null });
      setEditing(false);
      onSave(res.data);
    } catch { alert("Failed to save"); }
    setSaving(false);
  };

  if (editing) {
    return (
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
        <h3 className="mb-2 text-sm font-medium text-primary">Summary</h3>
        <textarea value={val} onChange={(e) => setVal(e.target.value)}
          className="w-full rounded border bg-background px-3 py-2 text-sm" rows={3} autoFocus disabled={saving} />
        <div className="flex gap-2 mt-2">
          <button onClick={handleSave} disabled={saving}
            className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
          <button onClick={() => { setEditing(false); setVal(value || ""); }}
            className="rounded border px-3 py-1.5 text-xs hover:bg-accent">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 cursor-pointer hover:bg-primary/10 transition-colors group"
      onClick={() => setEditing(true)}>
      <h3 className="mb-1 text-sm font-medium text-primary flex items-center justify-between">
        Summary
        <span className="text-[10px] text-primary/50 opacity-0 group-hover:opacity-100">click to edit</span>
      </h3>
      <p className="text-sm">{value || <span className="text-muted-foreground italic">No summary — click to add</span>}</p>
    </div>
  );
}

function EditableFilename({ value, docId, onSave }: { value: string; docId: number; onSave: (updated?: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { setVal(value || ""); }, [value]);

  const handleSave = async () => {
    if (!val.trim() || val === value) { setEditing(false); return; }
    setSaving(true);
    try {
      const res = await api.post(`/documents/${docId}/rename`, { filename: val });
      setEditing(false);
      onSave(res.data);
    } catch (e: any) {
      alert("Rename failed: " + (e.response?.data?.detail || e.message));
    }
    setSaving(false);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/documents/${docId}/generate-filename`);
      const suggested = res.data.suggested_filename;
      if (suggested) {
        setVal(suggested);
        setEditing(true);
      }
    } catch (e: any) {
      alert("Failed to generate filename: " + (e.response?.data?.detail || e.message));
    }
    setGenerating(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") { setEditing(false); setVal(value); } }}
          className="text-xl font-semibold bg-background border rounded px-2 py-1 flex-1"
          autoFocus disabled={saving} />
        <button onClick={handleSave} disabled={saving}
          className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">
          {saving ? "..." : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setVal(value); }}
          className="rounded border px-2 py-1.5 text-xs hover:bg-accent">
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <h1 className="text-xl font-semibold group cursor-pointer flex items-center gap-2">
      <span onClick={() => setEditing(true)}>{value}</span>
      <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
        <button onClick={() => setEditing(true)}
          className="text-muted-foreground text-xs font-normal hover:text-foreground" title="Edit filename">
          &#x270E;
        </button>
        <button onClick={handleGenerate} disabled={generating}
          className="text-muted-foreground text-xs font-normal hover:text-primary disabled:opacity-50"
          title="Generate filename from document data">
          {generating ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </span>
    </h1>
  );
}
