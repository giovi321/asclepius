import { useAuth } from "@/contexts/AuthContext";
import { usePatient } from "@/contexts/PatientContext";

export default function PatientSelector() {
  const { user } = useAuth();
  const { selectedPatient, setSelectedPatient } = usePatient();

  const patients = user?.patients || [];

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
