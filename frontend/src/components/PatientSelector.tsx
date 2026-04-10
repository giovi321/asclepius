import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { usePatient } from "@/contexts/PatientContext";
import api from "@/api/client";
import { Plus } from "lucide-react";

export default function PatientSelector() {
  const { user } = useAuth();
  const { selectedPatient, setSelectedPatient } = usePatient();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [creating, setCreating] = useState(false);

  const patients = user?.patients || [];

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post("/patients", {
        display_name: name.trim(),
        date_of_birth: dob || null,
      });
      const newPatient = res.data;
      setSelectedPatient({
        id: newPatient.id,
        slug: newPatient.slug,
        display_name: newPatient.display_name,
      });
      // Reload to refresh patient list in auth context
      window.location.reload();
    } catch {
      alert("Failed to create patient");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
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

      {!showCreate ? (
        <button
          onClick={() => setShowCreate(true)}
          className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Add patient
        </button>
      ) : (
        <div className="space-y-2 rounded-md border p-2">
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
            autoFocus
          />
          <input
            type="date"
            placeholder="Date of birth"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className="w-full rounded border px-2 py-1 text-xs"
          />
          <div className="flex gap-1">
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="flex-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
            >
              {creating ? "..." : "Create"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setName(""); setDob(""); }}
              className="rounded border px-2 py-1 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
