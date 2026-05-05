import React, { createContext, useContext, useEffect, useState } from "react";
import type { Patient } from "@/types";
import { usePatients } from "@/hooks/data";

interface PatientContextType {
  selectedPatient: Patient | null;
  setSelectedPatient: (p: Patient | null) => void;
}

const PatientContext = createContext<PatientContextType | null>(null);

export function PatientProvider({ children }: { children: React.ReactNode }) {
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(() => {
    const stored = localStorage.getItem("asclepius_patient");
    return stored ? JSON.parse(stored) : null;
  });

  // Validate the stored patient still exists in DB. We read from the shared
  // /patients cache — once it loads the first time on any page, this check
  // is a no-op.
  const { data: patients } = usePatients();
  useEffect(() => {
    if (selectedPatient && Array.isArray(patients)) {
      const exists = patients.some((p: Patient) => p.id === selectedPatient.id);
      if (!exists) {
        setSelectedPatient(null);
        localStorage.removeItem("asclepius_patient");
      }
    }
  }, [patients, selectedPatient]);

  const handleSet = (p: Patient | null) => {
    setSelectedPatient(p);
    if (p) {
      localStorage.setItem("asclepius_patient", JSON.stringify(p));
    } else {
      localStorage.removeItem("asclepius_patient");
    }
  };

  return (
    <PatientContext.Provider
      value={{ selectedPatient, setSelectedPatient: handleSet }}
    >
      {children}
    </PatientContext.Provider>
  );
}

export function usePatient() {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error("usePatient must be used within PatientProvider");
  return ctx;
}
