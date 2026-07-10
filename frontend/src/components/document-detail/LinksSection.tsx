import { useEffect, useState } from "react";
import {
  FileText,
  Image as ImageIcon,
  Link2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import api from "@/api/client";
import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/contexts/ToastContext";
import { Section } from "@/components/document-detail/DocumentDetailHelpers";
import SuggestLinksButton from "@/components/document-detail/SuggestLinksButton";
import Badge from "@/components/ui/Badge";
import { useBreakpoint } from "@/hooks/useMediaQuery";

export interface LinksSectionProps {
  docId: number;
  patientId: number | null;
  links: any[];
  onLinksChange: (next: any[]) => void;
}

/**
 * "Linked Documents" card on the Document Detail page. Owns:
 * - the current link list (kept in sync via onLinksChange)
 * - AI-suggested "Relevant Documents" fetched from /relevant
 * - the manual link-search dialog + selector
 */
export default function LinksSection({
  docId,
  patientId,
  links,
  onLinksChange,
}: LinksSectionProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const [relevantDocs, setRelevantDocs] = useState<any[]>([]);
  const [loadingRelevant, setLoadingRelevant] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [linkType, setLinkType] = useState("related");

  useEffect(() => {
    if (!patientId) return;
    setLoadingRelevant(true);
    api
      .get(`/documents/${docId}/relevant`)
      .then((res: any) => setRelevantDocs(res.data.suggestions || []))
      .catch(() => {})
      .finally(() => setLoadingRelevant(false));
  }, [docId, patientId]);

  // Filter out the docs already shown (real links + synthetic imaging entries)
  // so the manual-link search doesn't surface them as candidates again.
  const alreadyLinkedIds = new Set<number>(
    links
      .flatMap((l: any) => [l.source_document_id, l.target_document_id])
      .filter((v: any) => typeof v === "number"),
  );
  alreadyLinkedIds.add(docId);

  const filterLinked = (docs: any[]) =>
    docs.filter((d: any) => !alreadyLinkedIds.has(d.id));

  const runSearch = async () => {
    if (!searchTerm.trim()) {
      try {
        const res = await api.get("/documents", { params: { limit: 30 } });
        setSearchResults(filterLinked(res.data.items || []));
      } catch {
        setSearchResults([]);
      }
      return;
    }
    try {
      const res = await api.get("/documents", {
        params: { q: searchTerm, limit: 30 },
      });
      let results = filterLinked(res.data.items || []);
      if (results.length === 0) {
        const allRes = await api.get("/documents", { params: { limit: 100 } });
        const all = allRes.data.items || [];
        const term = searchTerm.toLowerCase();
        results = filterLinked(
          all.filter(
            (d: any) =>
              d.original_filename?.toLowerCase().includes(term) ||
              d.doc_type?.toLowerCase().includes(term) ||
              d.doctor_name?.toLowerCase().includes(term) ||
              d.facility_name?.toLowerCase().includes(term) ||
              d.summary_en?.toLowerCase().includes(term) ||
              d.patient_name?.toLowerCase().includes(term),
          ),
        ).slice(0, 20);
      }
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  };

  const linkDocument = async (targetId: number) => {
    const scrollY = window.scrollY;
    try {
      const res = await api.post(`/documents/${docId}/link`, {
        target_document_id: targetId,
        link_type: linkType,
      });
      const linked = searchResults.find((d: any) => d.id === targetId);
      onLinksChange([
        ...links,
        {
          ...res.data,
          target_filename: linked?.original_filename,
          target_doc_type: linked?.doc_type,
        },
      ]);
      setSearchResults((prev) => prev.filter((d: any) => d.id !== targetId));
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (err?.response?.status === 409) {
        toast({
          title: detail || "These documents are already linked",
          variant: "warning",
        });
        setSearchResults((prev) => prev.filter((d: any) => d.id !== targetId));
      } else {
        toast({ title: detail || "Failed to link document", variant: "error" });
      }
    }
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  const unlink = async (linkId: number) => {
    try {
      await api.delete(`/documents/${docId}/links/${linkId}`);
      onLinksChange(links.filter((l: any) => l.id !== linkId));
    } catch {
      toast({ title: "Failed to remove link", variant: "error" });
    }
  };

  const acceptSuggestion = async (sg: any) => {
    const scrollY = window.scrollY;
    try {
      const res = await api.post(`/documents/${docId}/link`, {
        target_document_id: sg.document_id,
        link_type: sg.link_type || "related",
      });
      onLinksChange([
        ...links,
        {
          ...res.data,
          target_filename: sg.filename,
          target_doc_type: sg.doc_type,
        },
      ]);
      setRelevantDocs((prev) =>
        prev.filter((r) => r.document_id !== sg.document_id),
      );
    } catch (e: any) {
      if (e?.response?.status === 409) {
        setRelevantDocs((prev) =>
          prev.filter((r) => r.document_id !== sg.document_id),
        );
      } else {
        toast({
          title: "Failed to link",
          description: getErrorMessage(e),
          variant: "error",
        });
      }
    }
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  };

  return (
    <Section
      title="Linked Documents"
      icon={Link2}
      sectionId="linked-documents"
      defaultOpen={!isMobile && (links.length > 0 || relevantDocs.length > 0)}
      headerExtra={
        links.length > 0 ? <Badge size="sm">{links.length}</Badge> : undefined
      }
    >
      {links.length > 0 ? (
        <div className="space-y-2">
          {links.map((link: any) => {
            // The link row carries metadata for both ends. Pick the side
            // that ISN'T this document so we render "the other end".
            const otherSide =
              link.source_document_id === docId ? "target" : "source";
            const linkedDocId = link[`${otherSide}_document_id`];
            const linkedName =
              link[`${otherSide}_filename`] || `Document #${linkedDocId}`;
            const studyId = link[`${otherSide}_imaging_study_id`];
            const modality = link[`${otherSide}_modality`];
            const isImaging = Boolean(studyId);
            // ``link.id == null`` flags a synthetic row appended by
            // get_document_links() to represent imaging_studies.document_id.
            // Synthetic rows can't be unlinked here — the imaging↔report
            // binding is managed by ReportSlot's Detach action.
            const isSynthetic = link.id == null;
            const target = isImaging
              ? `/imaging/${studyId}`
              : `/documents/${linkedDocId}`;
            return (
              <div
                key={isSynthetic ? `imaging-${studyId}` : `link-${link.id}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <button
                  onClick={() => navigate(target)}
                  className="text-primary hover:underline truncate flex-1 text-left"
                >
                  {linkedName}
                </button>
                {isImaging && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info">
                    <ImageIcon className="h-3 w-3" />
                    Imaging{modality ? ` · ${modality}` : ""}
                  </span>
                )}
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {link.link_type || "related"}
                </span>
                {!isSynthetic && (
                  <button
                    onClick={() => unlink(link.id)}
                    className="ml-2 flex items-center justify-center rounded p-1 text-muted-foreground hover:text-destructive coarse:min-h-11 coarse:min-w-11"
                    title="Remove link"
                    aria-label="Remove link"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No linked documents</p>
      )}

      {(relevantDocs.length > 0 || loadingRelevant) && (
        <div className="mt-3 pt-3 border-t">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">
            Suggested by AI
          </h4>
          {loadingRelevant ? (
            <p className="text-xs text-muted-foreground">
              Analyzing document relationships...
            </p>
          ) : (
            <div className="space-y-2">
              {relevantDocs.map((sg: any) => (
                <div
                  key={sg.document_id}
                  className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <a
                      href={`/documents/${sg.document_id}`}
                      className="text-primary hover:underline block truncate font-medium"
                    >
                      {sg.filename || `Document #${sg.document_id}`}
                    </a>
                    <span className="text-muted-foreground">
                      {sg.doc_type?.replace(/_/g, " ")} |{" "}
                      {sg.event_date || "no date"}
                    </span>
                    {sg.reason && (
                      <p className="text-muted-foreground italic mt-0.5">
                        {sg.reason}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => acceptSuggestion(sg)}
                    className="rounded bg-primary/10 px-2 py-1 text-primary hover:bg-primary/20 whitespace-nowrap"
                  >
                    Link
                  </button>
                  <button
                    onClick={() =>
                      setRelevantDocs((prev) =>
                        prev.filter((r) => r.document_id !== sg.document_id),
                      )
                    }
                    className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-destructive coarse:min-h-11 coarse:min-w-11"
                    aria-label="Dismiss suggestion"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showSearch ? (
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              setShowSearch(true);
              setSearchTerm("");
              runSearch();
            }}
            className="flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Link manually
          </button>
          <SuggestLinksButton
            docId={docId}
            onLink={(newLink) => {
              if (newLink) onLinksChange([...links, newLink]);
            }}
          />
        </div>
      ) : (
        <div className="mt-2 space-y-2 rounded-md border p-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2 h-3 w-3 text-muted-foreground" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
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
              onClick={runSearch}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
            >
              Search
            </button>
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchTerm("");
                setSearchResults([]);
              }}
              className="rounded-md border px-2 py-1.5 text-xs hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-60 overflow-y-auto divide-y rounded-md border">
              {searchResults
                .filter((d: any) => !alreadyLinkedIds.has(d.id))
                .map((d: any) => (
                  <div key={d.id} className="group relative">
                    <button
                      onClick={() => linkDocument(d.id)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      <FileText className="h-3 w-3 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-medium">
                          {d.original_filename}
                        </span>
                        <span className="block text-muted-foreground">
                          {d.doc_type?.replace(/_/g, " ") || "no type"} |{" "}
                          {d.event_date || "no date"}
                          {d.doctor_name && ` | ${d.doctor_name}`}
                          {d.facility_name && ` | ${d.facility_name}`}
                        </span>
                        {d.summary_en && (
                          <span className="block text-muted-foreground truncate">
                            {d.summary_en}
                          </span>
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
  );
}
