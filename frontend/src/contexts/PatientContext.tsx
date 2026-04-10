import React, { createContext, useContext, useState } from "react";

interface Patient {
  id: number;
  slug: string;
  display_name: string;
}

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

  const handleSet = (p: Patient | null) => {
    setSelectedPatient(p);
    if (p) {
      localStorage.setItem("asclepius_patient", JSON.stringify(p));
    } else {
      localStorage.removeItem("asclepius_patient");
    }
  };

  return (
    <PatientContext.Provider value={{ selectedPatient, setSelectedPatient: handleSet }}>
      {children}
    </PatientContext.Provider>
  );
}

export function usePatient() {
  const ctx = useContext(PatientContext);
  if (!ctx) throw new Error("usePatient must be used within PatientProvider");
  return ctx;
}
