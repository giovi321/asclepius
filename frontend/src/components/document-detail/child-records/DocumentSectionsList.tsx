import { Section, getSectionTypeStyle } from "@/components/document-detail/DocumentDetailHelpers";

/** Vision-LLM emits structured DOM-like text ("<div data-bbox=...>") to
 * preserve layout. When the LLM-summarisation step is skipped (>10 sections)
 * the raw markup leaks into ``summary_en``. Strip tags and pull alt /
 * data-label values up so the user sees the semantic description. */
const _ALT_OR_LABEL = /(?:alt|data-label)\s*=\s*"([^"]+)"/gi;
const _HTML_TAG = /<[^>]*>/g;

function cleanSectionSummary(s: string | null | undefined): string {
  if (!s) return "";
  if (!s.includes("<")) return s.trim();
  const semantic: string[] = [];
  for (const m of s.matchAll(_ALT_OR_LABEL)) semantic.push(m[1].trim());
  const stripped = s.replace(_HTML_TAG, " ");
  const combined = (semantic.join(" ") + " " + stripped)
    .replace(/\s+/g, " ")
    .trim();
  return combined.length > 280
    ? combined.slice(0, 280).trimEnd() + "\u2026"
    : combined;
}

export function DocumentSectionsList({ sections }: { sections: any[] }) {
  if (!sections?.length) return null;
  return (
    <Section
      title={`Document Sections (${sections.length})`}
      sectionId="document-sections"
      defaultOpen={false}
    >
      {sections.map((section) => {
        const cleaned = cleanSectionSummary(section.summary_en);
        return (
          <div
            key={section.id}
            className="flex items-center gap-3 text-sm rounded-md border p-2"
          >
            <span className="text-xs text-muted-foreground w-16">
              pp. {section.page_start}
              {"\u2013"}
              {section.page_end}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getSectionTypeStyle(section.section_type)}`}
            >
              {section.section_type?.replace(/_/g, " ")}
            </span>
            {cleaned && (
              <span
                className="flex-1 text-xs text-muted-foreground truncate"
                title={cleaned}
              >
                {cleaned}
              </span>
            )}
          </div>
        );
      })}
    </Section>
  );
}
