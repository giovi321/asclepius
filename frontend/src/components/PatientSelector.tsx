import { useEffect, useRef, useState } from "react";
import { usePatient } from "@/contexts/PatientContext";
import { User, Users as UsersIcon, Check, ChevronsUpDown, Search, X } from "lucide-react";
import type { Patient } from "@/types";
import { usePatients } from "@/hooks/data";

type PatientRow = Patient;

export default function PatientSelector() {
  const { selectedPatient, setSelectedPatient } = usePatient();
  const { data, refetch } = usePatients();
  const patients: PatientRow[] = Array.isArray(data) ? data : [];
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the list fresh so newly-added patients show up without a page reload.
  useEffect(() => {
    const interval = setInterval(() => refetch(), 10000);
    return () => clearInterval(interval);
  }, [refetch]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const filtered = query.trim()
    ? patients.filter((p) =>
        p.display_name.toLowerCase().includes(query.toLowerCase()) ||
        (p.slug || "").toLowerCase().includes(query.toLowerCase()),
      )
    : patients;

  const pick = (p: PatientRow | null) => {
    setSelectedPatient(p);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent transition-colors"
      >
        {selectedPatient ? (
          <>
            <User className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left font-medium">
              {selectedPatient.display_name}
            </span>
          </>
        ) : (
          <>
            <UsersIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            <span className="flex-1 min-w-0 truncate text-left text-muted-foreground">
              All patients
            </span>
          </>
        )}
        <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1.5 w-full min-w-[240px] rounded-lg border bg-card text-card-foreground shadow-xl overflow-hidden z-30">
          <div className="relative border-b px-2 py-1.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patients…"
              className="w-full rounded-md bg-transparent pl-7 pr-6 py-1 text-sm focus:outline-none"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-[320px] overflow-y-auto py-1">
            <button
              onClick={() => pick(null)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent ${!selectedPatient ? "bg-accent/50" : ""}`}
            >
              <UsersIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="flex-1">All patients</span>
              {!selectedPatient && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>

            {filtered.length === 0 && query && (
              <div className="px-3 py-2 text-xs text-muted-foreground italic">
                No patients match "{query}"
              </div>
            )}

            {filtered.map((p) => {
              const isActive = selectedPatient?.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => pick(p)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent ${isActive ? "bg-accent/50" : ""}`}
                >
                  <User className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="flex-1 truncate">{p.display_name}</span>
                  {isActive && <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
