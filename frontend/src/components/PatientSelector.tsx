import { useEffect, useState } from "react";
import { usePatient } from "@/contexts/PatientContext";
import api from "@/api/client";

export default function PatientSelector() {
  const { selectedPatient, setSelectedPatient } = usePatient();
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => {
    api.get("/patients").then((res) => {
      setPatients(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
  }, []);

  // Re-fetch when component mounts (catches new patients created elsewhere)
  useEffect(() => {
    const interval = setInterval(() => {
      api.get("/patients").then((res) => {
        setPatients(Array.isArray(res.data) ? res.data : []);
      }).catch(() => {});
    }, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <select
      className="w-full rounded-md border bg-background px-3 py-1.5 text-sm"
      value={selectedPatient?.id || ""}
      onChange={(e) => {
        const id = Number(e.target.value);
        const patient = patients.find((p) => p.id === id);
        setSelectedPatient(patient || null);
      }}
    >
      <option value="">All patients</option>
      {patients.map((p) => (
        <option key={p.id} value={p.id}>
          {p.display_name}
        </option>
      ))}
    </select>
  );
}
