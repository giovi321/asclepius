import { Link } from "react-router-dom";
import type { Credential } from "@/types";
import { ExternalLink } from "lucide-react";

interface CredentialPickerProps {
  label?: string;
  value: string;
  onChange: (id: string) => void;
  credentials: Credential[];
  /** Filter to credentials whose type is in this list. Omit to allow any. */
  allowedTypes?: string[];
  description?: string;
}

export default function CredentialPicker({
  label = "Credential",
  value,
  onChange,
  credentials,
  allowedTypes,
  description,
}: CredentialPickerProps) {
  const filtered = allowedTypes
    ? credentials.filter((c) => allowedTypes.includes(c.type))
    : credentials;

  const empty = filtered.length === 0;

  return (
    <label className="space-y-1 block">
      <span className="text-sm font-medium flex items-center justify-between">
        {label}
        <Link
          to="/settings/credentials"
          className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          title="Manage credentials"
        >
          Manage <ExternalLink className="h-3 w-3" />
        </Link>
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">— pick a credential —</option>
        {filtered.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.type})
          </option>
        ))}
      </select>
      {empty && (
        <span className="block text-xs text-amber-600 dark:text-amber-500">
          No matching credentials. <Link to="/settings/credentials" className="underline">Add one</Link>{allowedTypes ? ` of type ${allowedTypes.join(" / ")}` : ""}.
        </span>
      )}
      {description && (
        <span className="block text-xs text-muted-foreground">{description}</span>
      )}
    </label>
  );
}
