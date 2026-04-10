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
    setTags(res.data.tags || []);
    setLinkedDocs(res.data.linked_documents || []);
    setLoading(false);
  };

  useEffect(() => {
    loadDoc();
  }, [id]);

  const handleReprocess = async () => {
    await api.post(`/documents/${id}/reprocess`);
    await loadDoc();
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
      await api.patch(`/documents/${id}`, { tags: updated });
      setTags(updated);
      setNewTag("");
    } catch {
      alert("Failed to add tag");
    }
  };

  const handleRemoveTag = async (tag: string) => {
    const updated = tags.filter((t) => t !== tag);
    try {
      await api.patch(`/documents/${id}`, { tags: updated });
      setTags(updated);
    } catch {
      alert("Failed to remove tag");
    }
  };

  const handleSearchLink = async () => {
    if (!linkSearch.trim()) return;
    try {
      const res = await api.get("/documents", { params: { q: linkSearch, limit: 10 } });
      setLinkResults((res.data.items || []).filter((d: any) => d.id !== Number(id)));
    } catch {
      setLinkResults([]);
    }
  };

  const handleLinkDocument = async (targetId: number) => {
    try {
      await api.post(`/documents/${id}/links`, { target_document_id: targetId, link_type: linkType });
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
            {doc.doc_type?.replace(/_/g, " ")} | {doc.doc_date || "No date"} | {doc.patient_name || "Unclassified"}
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
            <InfoRow label="Type" value={doc.doc_type} />
            <InfoRow label="Document Date" value={doc.doc_date} />
            <InfoRow label="Date Issued" value={doc.date_issued} />
            <InfoRow label="Date of Visit" value={doc.date_visit} />
            <InfoRow label="Date Received" value={doc.date_received} />
            <InfoRow label="Doctor" value={doc.doctor_name || doc.doctor} />
            <InfoRow label="Facility" value={doc.facility_name || doc.facility} />
            <InfoRow label="Specialty" value={doc.specialty} />
            <InfoRow label="Language" value={doc.language_source} />
            <InfoRow label="OCR Engine" value={doc.ocr_engine} />
            <InfoRow label="OCR Confidence" value={doc.ocr_confidence?.toFixed(2)} />
            <InfoRow label="Cost" value={doc.cost_amount ? `${doc.cost_amount} ${doc.cost_currency}` : null} />
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
              <button
                onClick={() => setShowLinkSearch(true)}
                className="mt-2 flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Link document
              </button>
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
                    <option value="follow_up">Follow-up</option>
                    <option value="supersedes">Supersedes</option>
                    <option value="references">References</option>
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
                  <div className="max-h-40 overflow-y-auto divide-y rounded-md border">
                    {linkResults.map((d: any) => (
                      <button
                        key={d.id}
                        onClick={() => handleLinkDocument(d.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{d.original_filename}</span>
                        <span className="ml-auto text-muted-foreground">{d.doc_date || ""}</span>
                      </button>
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

function InfoRow({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
