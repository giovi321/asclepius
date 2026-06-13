import { cn } from "@/lib/utils";

/**
 * A pipeline provider (OCR / LLM / Vision-LLM). The picker only needs the
 * id, an optional display name, and the enabled flag — callers filter to
 * enabled providers before passing them in.
 */
export interface Provider {
  id: string;
  name?: string | null;
  enabled: boolean;
}

export type ProviderKind = "ocr" | "llm" | "vision";

export interface ProviderSelectProps {
  /** Which provider list this picker selects from (for clarity at call sites). */
  kind: ProviderKind;
  /** Empty string means "use default (highest priority)". */
  value: string;
  onChange: (value: string) => void;
  options: Provider[];
  /** Label for the empty/default option. */
  defaultLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * The provider `<select>` that was copy-pasted across TranslateMenu,
 * ReprocessMenu, and ShareDialog. Renders a leading "use default" option
 * followed by one option per provider, labelled by name (falling back to
 * id) — identical to every hand-rolled copy.
 */
export default function ProviderSelect({
  kind,
  value,
  onChange,
  options,
  defaultLabel = "Default (highest priority)",
  className,
  disabled,
}: ProviderSelectProps) {
  return (
    <select
      // Inert marker identifying which provider list this picker drives.
      // Has no visual or accessible-name impact (the surrounding label text
      // still names the control exactly as in the hand-rolled originals).
      data-provider-kind={kind}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "w-full rounded-md border bg-background px-2 py-1.5 text-sm",
        className,
      )}
    >
      <option value="">{defaultLabel}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || p.id}
        </option>
      ))}
    </select>
  );
}
