import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api/client";
import {
  RefreshCw, FileText, TestTube, Pill, Syringe, Stethoscope, Download,
  Trash2, Plus, X, Link2, Search, ChevronDown,
} from "lucide-react";
import PdfViewer from "@/components/PdfViewer";
import { formatDocType, getBestDate } from "@/lib/utils";
import {
  Section, InfoRow, EditableField, EditableSummary, EditableFilename,
  OcrSection, TechnicalDetails, getSectionTypeStyle, MedFormBadge,
} from "@/components/document-detail/DocumentDetailHelpers";
import EventSelector from "@/components/document-detail/EventSelector";
import SuggestLinksButton from "@/components/document-detail/SuggestLinksButton";
import { useToast } from "@/contexts/ToastContext";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
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

  // Reprocess popover state
  const [showReprocessMenu, setShowReprocessMenu] = useState(false);
  const [llmProviders, setLlmProviders] = useState<any[]>([]);
  const [ocrProviders, setOcrProviders] = useState<any[]>([]);
  const [reprocessMode, setReprocessMode] = useState("both");
  const [reprocessLlmProvider, setReprocessLlmProvider] = useState("");
  const [reprocessOcrProvider, setReprocessOcrProvider] = useState("");
  const reprocessRef = useRef<HTMLDivElement>(null);

  // Load providers once
  useEffect(() => {
    api.get("/settings/llm-providers").then((res: any) => {
      setLlmProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
    api.get("/settings/ocr-providers").then((res: any) => {
      setOcrProviders((res.data || []).filter((p: any) => p.enabled));
    }).catch(() => {});
  }, []);

  // Close popover on outside click
  useEffect(() => {
    if (!showReprocessMenu) return;
    const handler = (e: MouseEvent) => {
      if (reprocessRef.current && !reprocessRef.current.contains(e.target as Node)) {
        setShowReprocessMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showReprocessMenu]);

  const handleReprocess = async () => {
    setShowReprocessMenu(false);
    await api.post(`/documents/${id}/reprocess`, {
      mode: reprocessMode,
      ...(reprocessLlmProvider ? { llm_provider_id: reprocessLlmProvider } : {}),
      ...(reprocessOcrProvider ? { ocr_provider_id: reprocessOcrProvider } : {}),
    });
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
      toast({ title: "AI edit failed", description: e.response?.data?.detail || e.message, variant: "error" });
    } finally {
      setAiEditing(false);
    }
  };

  const handleCancel = async () => {
    try {
      await api.post(`/documents/${id}/cancel`);
      await loadDoc();
    } catch {
      toast({ title: "Failed to cancel processing", variant: "error" });
    }
  };

  const handleRotate = async (degrees: number, pages: number[] | null) => {
    try {
      await api.post(`/documents/${id}/rotate`, { degrees, pages });
      await loadDoc(false);
    } catch (e: any) {
      toast({ title: "Rotation failed", description: e.response?.data?.detail || e.message, variant: "error" });
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
      .then((res: any) => setRelevantDocs(res.data.suggestions || []))
      .catch(() => {})
      .finally(() => setLoadingRelevant(false));
  }, [doc?.id, doc?.patient_id]);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this document? This action cannot be undone.")) return;
    try {
      await api.delete(`/documents/${id}`);
      navigate("/documents");
    } catch {
      toast({ title: "Failed to delete document", variant: "error" });
    }
  };

  const handleSaveNotes = async () => {
    try {
      await api.patch(`/documents/${id}`, { user_notes: notes });
      setEditingNotes(false);
    } catch {
      toast({ title: "Failed to save notes", variant: "error" });
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
      setLinkedDocs((prev: any[]) => [...prev, {
        ...res.data,
        target_filename: linked?.original_filename,
        target_doc_type: linked?.doc_type,
      }]);
      setLinkResults((prev: any[]) => prev.filter((d: any) => d.id !== targetId));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        toast({ title: detail || "These documents are already linked", variant: "warning" });
        setLinkResults((prev: any[]) => prev.filter((d: any) => d.id !== targetId));
      } else {
        toast({ title: detail || "Failed to link document", variant: "error" });
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
            {formatDocType(doc.doc_type)} | {getBestDate(doc) || "No date"} | {doc.patient_name || "Unclassified"}
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
            <div ref={reprocessRef} className="relative">
              <button
                onClick={() => setShowReprocessMenu(!showReprocessMenu)}
                className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4" /> Reprocess <ChevronDown className="h-3 w-3 ml-0.5" />
              </button>
              {showReprocessMenu && (
                <div className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border bg-background shadow-xl p-3 space-y-3">
                  <p className="text-xs font-medium text-muted-foreground">What to reprocess</p>
                  <div className="flex gap-1">
                    {[
                      { value: "both", label: "OCR + LLM" },
                      { value: "ocr", label: "OCR only" },
                      { value: "llm", label: "LLM only" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setReprocessMode(opt.value)}
                        className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                          reprocessMode === opt.value
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {reprocessMode !== "llm" && ocrProviders.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">OCR Provider</p>
                      <select
                        value={reprocessOcrProvider}
                        onChange={(e) => setReprocessOcrProvider(e.target.value)}
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">Default (highest priority)</option>
                        {ocrProviders.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {reprocessMode !== "ocr" && llmProviders.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">LLM Provider</p>
                      <select
                        value={reprocessLlmProvider}
                        onChange={(e) => setReprocessLlmProvider(e.target.value)}
                        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                      >
                        <option value="">Default (highest priority)</option>
                        {llmProviders.map((p: any) => (
                          <option key={p.id} value={p.id}>
                            {p.name || p.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <button
                    onClick={() => handleReprocess()}
                    className="w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Start Reprocessing
                  </button>
                </div>
              )}
            </div>
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
            {(doc.ocr_engine || doc.ocr_confidence != null || doc.llm_provider) && (
              <TechnicalDetails
                ocrEngine={doc.ocr_engine}
                ocrConfidence={doc.ocr_confidence}
                llmProvider={doc.llm_provider}
              />
            )}
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
                          } catch { toast({ title: "Failed to remove link", variant: "error" }); }
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
                                toast({ title: "Failed to link", description: e.response?.data?.detail || e.message, variant: "error" });
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

