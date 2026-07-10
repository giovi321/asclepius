import { useEffect, useState } from "react";
import { usePatient } from "@/contexts/PatientContext";
import { Check, ChevronsUpDown, User, Users as UsersIcon } from "lucide-react";
import type { Patient } from "@/types";
import { usePatients } from "@/hooks/data";
import { cn } from "@/lib/utils";
import PickerShell, { PickerOption } from "@/components/ui/PickerShell";

export interface PatientSelectorProps {
  /**
   * block: full-width bordered button (desktop sidebar footer)
   * chip:  compact pill for the mobile top bar
   */
  variant?: "block" | "chip";
}

/**
 * Global patient scope switcher. Presentation via PickerShell: bottom Sheet
 * on phones, anchored Popover on larger screens — the patient scope is
 * always reachable regardless of where the trigger lives.
 */
export default function PatientSelector({
  variant = "block",
}: PatientSelectorProps) {
  const { selectedPatient, setSelectedPatient } = usePatient();
  const { data, refetch } = usePatients();
  const patients: Patient[] = Array.isArray(data) ? data : [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Keep the list fresh so newly-added patients show up without a reload.
  useEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  const filtered = query.trim()
    ? patients.filter(
        (p) =>
          p.display_name.toLowerCase().includes(query.toLowerCase()) ||
          (p.slug || "").toLowerCase().includes(query.toLowerCase()),
      )
    : patients;

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const pick = (p: Patient | null) => {
    setSelectedPatient(p);
    handleOpenChange(false);
  };

  const trigger =
    variant === "chip" ? (
      <button
        type="button"
        aria-label={
          selectedPatient
            ? `Patient: ${selectedPatient.display_name}`
            : "All patients"
        }
        className="flex h-9 max-w-[40vw] items-center gap-1.5 rounded-full border bg-background px-3 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-10"
      >
        {selectedPatient ? (
          <>
            <User className="h-4 w-4 flex-shrink-0 text-primary" />
            <span className="hidden min-w-0 truncate font-medium min-[360px]:inline">
              {selectedPatient.display_name.split(" ")[0]}
            </span>
          </>
        ) : (
          <>
            <UsersIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="hidden min-w-0 truncate text-muted-foreground min-[360px]:inline">
              All
            </span>
          </>
        )}
      </button>
    ) : (
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {selectedPatient ? (
          <>
            <User className="h-4 w-4 flex-shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-left font-medium">
              {selectedPatient.display_name}
            </span>
          </>
        ) : (
          <>
            <UsersIcon className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              All patients
            </span>
          </>
        )}
        <ChevronsUpDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      </button>
    );

  return (
    <PickerShell
      open={open}
      onOpenChange={handleOpenChange}
      title="Select patient"
      search={query}
      onSearchChange={setQuery}
      searchPlaceholder="Search patients…"
      trigger={trigger}
      panelClassName={cn(variant === "block" && "w-[248px]")}
    >
      <PickerOption
        selected={!selectedPatient}
        onClick={() => pick(null)}
      >
        <UsersIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <span className="flex-1">All patients</span>
        {!selectedPatient && <Check className="h-3.5 w-3.5 text-primary" />}
      </PickerOption>

      {filtered.length === 0 && query && (
        <div className="px-3 py-2 text-xs italic text-muted-foreground">
          No patients match "{query}"
        </div>
      )}

      {filtered.map((p) => {
        const isActive = selectedPatient?.id === p.id;
        return (
          <PickerOption key={p.id} selected={isActive} onClick={() => pick(p)}>
            <User className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate">{p.display_name}</span>
            {isActive && (
              <Check className="h-3.5 w-3.5 flex-shrink-0 text-primary" />
            )}
          </PickerOption>
        );
      })}
    </PickerShell>
  );
}
