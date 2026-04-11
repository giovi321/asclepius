import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "@/api/client";
import {
  RefreshCw, FileText, TestTube, Pill, Syringe, Stethoscope, Download,
  Eye, EyeOff, Trash2, Plus, X, Link2, Search, Tag,
} from "lucide-react";
import PdfViewer from "@/components/PdfViewer";

export default function DocumentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [editingNotes, setEditingNotes] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [linkedDocs, setLinkedDocs] = useState<any[]>([]);
  const [showLinkSearch, setShowLinkSearch] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkType, setLinkType] = useState("related");

  const loadDoc = async () => {
    setLoading(true);
    const res = await api.get(`/documents/${id}`);
    setDoc(res.data);
    setNotes(res.data.user_notes || "");
    const rawTags = res.data.tags || "";
    setTags(typeof rawTags === "string" ? (rawTags ? rawTags.split(",").map((t: string) => t.trim()) : []) : rawTags);
    setLinkedDocs(res.data.links || []);
    setLoading(false);
  };

  useEffect(() => {
    loadDoc();
  }, [id]);

  const [aiInstruction, setAiInstruction] = useState("");
  const [aiEditing, setAiEditing] = useState(false);

  const handleReprocess = async () => {
    await api.post(`/documents/${id}/reprocess`);
    await loadDoc();
  };

  const handleAiEdit = async () => {
    if (!aiInstruction.trim()) return;
    setAiEditing(true);
    try {
      await api.post(`/documents/${id}/edit-with-ai`, { instruction: aiInstruction });
      setAiInstruction("");
      await loadDoc();
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

  // Auto-refresh while processing
  useEffect(() => {
    if (doc?.status === "processing" || doc?.status === "pending") {
      const interval = setInterval(loadDoc, 3000);
      return () => clearInterval(interval);
    }
  }, [doc?.status]);

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

  const handleAddTag = async () => {
    if (!newTag.trim()) return;
    const updated = [...tags, newTag.trim()];
    try {
      await api.patch(`/documents/${id}`, { tags: updated.join(",") });
      setTags(updated);
      setNewTag("");
    } catch {
      alert("Failed to add tag");
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const updated = tags.filter((t) => t !== tag);
    try {
      await api.patch(`/documents/${id}`, { tags: updated.join(",") });
      setTags(updated);
    } catch {
      alert("Failed to remove tag");
    }
  };

  const handleSearchLink = async () => {
    if (!linkSearch.trim()) {
      // Show all documents if search is empty
      try {
        const res = await api.get("/documents", { params: { limit: 20 } });
        setLinkResults((res.data.items || []).filter((d: any) => d.id !== Number(id)));
      } catch { setLinkResults([]); }
      return;
    }
    try {
      // Try FTS search first
      const res = await api.get("/documents", { params: { q: linkSearch, limit: 20 } });
      let results = (res.data.items || []).filter((d: any) => d.id !== Number(id));

      // If FTS returns nothing, fallback to fetching all and filtering client-side
      if (results.length === 0) {
        const allRes = await api.get("/documents", { params: { limit: 100 } });
        const all = allRes.data.items || [];
        const term = linkSearch.toLowerCase();
        results = all.filter((d: any) =>
          d.id !== Number(id) && (
            d.original_filename?.toLowerCase().includes(term) ||
            d.doc_type?.toLowerCase().includes(term) ||
            d.doctor_name?.toLowerCase().includes(term) ||
            d.facility_name?.toLowerCase().includes(term) ||
            d.summary_en?.toLowerCase().includes(term) ||
            d.patient_name?.toLowerCase().includes(term)
          )
        ).slice(0, 20);
      }

      setLinkResults(results);
    } catch {
      setLinkResults([]);
    }
  };

  const handleLinkDocument = async (targetId: number) => {
    try {
      await api.post(`/documents/${id}/link`, { target_document_id: targetId, link_type: linkType });
      await loadDoc();
      setShowLinkSearch(false);
      setLinkSearch("");
      setLinkResults([]);
    } catch {
      alert("Failed to link document");
    }
  };

  if (loading) return <div className="text-muted-foreground">Loading...</div>;
  if (!doc) return <div className="text-destructive">Document not found</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{doc.original_filename}</h1>
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
      {doc.summary_en && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h3 className="mb-1 text-sm font-medium text-primary">Summary</h3>
          <p className="text-sm">{doc.summary_en}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Document viewer */}
        <div className="space-y-4">
          {doc.file_path?.endsWith(".pdf") ? (
            <div className="rounded-lg border overflow-hidden h-[700px]">
              <PdfViewer url={`/api/documents/${id}/file`} />
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
            <EditableField label="Type" value={doc.doc_type} field="doc_type" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Date of Visit" value={doc.date_visit} field="date_visit" type="date" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Date Issued" value={doc.date_issued} field="date_issued" type="date" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Doctor" value={doc.doctor_name} field="doctor_name" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Facility" value={doc.facility_name} field="facility_name" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Specialty" value={doc.specialty_original} field="specialty_original" docId={doc.id} onSave={loadDoc} />
            <EditableField label="Summary" value={doc.summary_en} field="summary_en" docId={doc.id} onSave={loadDoc} multiline />
            <InfoRow label="Language" value={doc.language_source} />
            <InfoRow label="OCR Engine" value={doc.ocr_engine} />
            <InfoRow label="OCR Confidence" value={doc.ocr_confidence?.toFixed(2)} />
          </Section>

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

          {/* Tags */}
          <Section title="Tags" icon={Tag}>
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="rounded-full p-0.5 hover:bg-primary/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                  placeholder="Add tag..."
                  className="w-24 rounded-md border bg-background px-2 py-1 text-xs"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!newTag.trim()}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          </Section>

          {/* Linked Documents */}
          <Section title="Linked Documents" icon={Link2}>
            {linkedDocs.length > 0 ? (
              <div className="space-y-2">
                {linkedDocs.map((link: any) => (
                  <div key={link.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <a
                      href={`/documents/${link.target_document_id || link.linked_document_id}`}
                      className="text-primary hover:underline truncate flex-1"
                    >
                      {link.target_filename || link.linked_filename || `Document #${link.target_document_id || link.linked_document_id}`}
                    </a>
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {link.link_type || "related"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked documents</p>
            )}
            {!showLinkSearch ? (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setShowLinkSearch(true); setLinkSearch(""); handleSearchLink(); }}
                  className="flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Plus className="h-3 w-3" /> Link manually
                </button>
                <SuggestLinksButton docId={doc.id} onLink={loadDoc} />
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
                    {linkResults.filter((d: any) => d.id !== doc.id).map((d: any) => (
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

function SuggestLinksButton({ docId, onLink }: { docId: number; onLink: () => void }) {
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
      await api.post(`/documents/${docId}/link`, { target_document_id: targetId, link_type: linkType });
      setSuggestions((s) => s?.filter((sg) => sg.document_id !== targetId) || null);
      onLink();
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

function EditableField({ label, value, field, docId, onSave, type = "text", multiline = false }: {
  label: string; value: any; field: string; docId: number; onSave: () => void;
  type?: string; multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/documents/${docId}`, { [field]: val || null });
      setEditing(false);
      onSave();
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
