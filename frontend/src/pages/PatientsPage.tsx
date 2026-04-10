import { useEffect, useState } from "react";
import api from "@/api/client";
import { Plus, Trash2, ChevronDown, ChevronUp, Save, X } from "lucide-react";

interface Patient {
  id: number;
  slug: string;
  display_name: string;
  date_of_birth?: string;
  sex?: string;
  blood_type?: string;
  phone?: string;
  email?: string;
  address?: string;
  allergies?: string;
  notes?: string;
  insurance_provider?: string;
  insurance_policy_number?: string;
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Patient>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newPatient, setNewPatient] = useState<Partial<Patient>>({});
  const [saving, setSaving] = useState(false);

  const loadPatients = async () => {
    setLoading(true);
    try {
      const res = await api.get("/patients");
      setPatients(Array.isArray(res.data) ? res.data : res.data.items || []);
    } catch {
      setPatients([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadPatients();
  }, []);

  const handleExpand = (patient: Patient) => {
    if (expandedId === patient.id) {
      setExpandedId(null);
      setEditData({});
    } else {
      setExpandedId(patient.id);
      setEditData({ ...patient });
    }
  };

  const handleSave = async () => {
    if (!expandedId) return;
    setSaving(true);
    try {
      await api.patch(`/patients/${expandedId}`, editData);
      await loadPatients();
      setExpandedId(null);
      setEditData({});
    } catch {
      alert("Failed to save patient");
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this patient? This action cannot be undone.")) return;
    try {
      await api.delete(`/patients/${id}`);
      await loadPatients();
      if (expandedId === id) {
        setExpandedId(null);
        setEditData({});
      }
    } catch {
      alert("Failed to delete patient");
    }
  };

  const handleCreate = async () => {
    if (!newPatient.display_name?.trim()) return;
    setSaving(true);
    try {
      await api.post("/patients", {
        display_name: newPatient.display_name?.trim(),
        date_of_birth: newPatient.date_of_birth || null,
        sex: newPatient.sex || null,
        blood_type: newPatient.blood_type || null,
        phone: newPatient.phone || null,
        email: newPatient.email || null,
        address: newPatient.address || null,
        allergies: newPatient.allergies || null,
        notes: newPatient.notes || null,
        insurance_provider: newPatient.insurance_provider || null,
        insurance_policy_number: newPatient.insurance_policy_number || null,
      });
      setNewPatient({});
      setShowCreate(false);
      await loadPatients();
    } catch {
      alert("Failed to create patient");
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Patients</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Patient
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="font-medium">Create New Patient</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-medium">Full Name *</span>
              <input
                type="text"
                value={newPatient.display_name || ""}
                onChange={(e) => setNewPatient({ ...newPatient, display_name: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                autoFocus
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Date of Birth</span>
              <input
                type="date"
                value={newPatient.date_of_birth || ""}
                onChange={(e) => setNewPatient({ ...newPatient, date_of_birth: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Sex</span>
              <select
                value={newPatient.sex || ""}
                onChange={(e) => setNewPatient({ ...newPatient, sex: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">--</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Blood Type</span>
              <select
                value={newPatient.blood_type || ""}
                onChange={(e) => setNewPatient({ ...newPatient, blood_type: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">--</option>
                {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bt) => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Phone</span>
              <input
                type="tel"
                value={newPatient.phone || ""}
                onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                value={newPatient.email || ""}
                onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 sm:col-span-2 lg:col-span-3">
              <span className="text-sm font-medium">Address</span>
              <input
                type="text"
                value={newPatient.address || ""}
                onChange={(e) => setNewPatient({ ...newPatient, address: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 sm:col-span-2 lg:col-span-3">
              <span className="text-sm font-medium">Allergies</span>
              <input
                type="text"
                value={newPatient.allergies || ""}
                onChange={(e) => setNewPatient({ ...newPatient, allergies: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Comma separated"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Insurance Provider</span>
              <input
                type="text"
                value={newPatient.insurance_provider || ""}
                onChange={(e) => setNewPatient({ ...newPatient, insurance_provider: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Insurance Policy #</span>
              <input
                type="text"
                value={newPatient.insurance_policy_number || ""}
                onChange={(e) => setNewPatient({ ...newPatient, insurance_policy_number: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 sm:col-span-2 lg:col-span-3">
              <span className="text-sm font-medium">Notes</span>
              <textarea
                value={newPatient.notes || ""}
                onChange={(e) => setNewPatient({ ...newPatient, notes: e.target.value })}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                rows={2}
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving || !newPatient.display_name?.trim()}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Creating..." : "Create Patient"}
            </button>
            <button
              onClick={() => { setShowCreate(false); setNewPatient({}); }}
              className="flex items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-accent"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Date of Birth</th>
              <th className="px-4 py-2 text-left font-medium">Sex</th>
              <th className="px-4 py-2 text-left font-medium">Blood Type</th>
              <th className="px-4 py-2 text-left font-medium">Phone</th>
              <th className="px-4 py-2 text-left font-medium">Email</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading...</td></tr>
            ) : patients.length === 0 ? (
              <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No patients found</td></tr>
            ) : (
              patients.map((patient) => (
                <PatientRow
                  key={patient.id}
                  patient={patient}
                  expanded={expandedId === patient.id}
                  editData={expandedId === patient.id ? editData : {}}
                  onToggle={() => handleExpand(patient)}
                  onEditChange={(data) => setEditData(data)}
                  onSave={handleSave}
                  onDelete={() => handleDelete(patient.id)}
                  saving={saving}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PatientRow({
  patient,
  expanded,
  editData,
  onToggle,
  onEditChange,
  onSave,
  onDelete,
  saving,
}: {
  patient: Patient;
  expanded: boolean;
  editData: Partial<Patient>;
  onToggle: () => void;
  onEditChange: (data: Partial<Patient>) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  return (
    <>
      <tr className="hover:bg-accent/50 cursor-pointer" onClick={onToggle}>
        <td className="px-4 py-2 font-medium">{patient.display_name}</td>
        <td className="px-4 py-2 text-muted-foreground">{patient.date_of_birth || "--"}</td>
        <td className="px-4 py-2 text-muted-foreground">{patient.sex || "--"}</td>
        <td className="px-4 py-2 text-muted-foreground">{patient.blood_type || "--"}</td>
        <td className="px-4 py-2 text-muted-foreground">{patient.phone || "--"}</td>
        <td className="px-4 py-2 text-muted-foreground">{patient.email || "--"}</td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-muted/20 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-w-4xl">
              <label className="space-y-1">
                <span className="text-sm font-medium">Full Name</span>
                <input
                  type="text"
                  value={editData.display_name || ""}
                  onChange={(e) => onEditChange({ ...editData, display_name: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Date of Birth</span>
                <input
                  type="date"
                  value={editData.date_of_birth || ""}
                  onChange={(e) => onEditChange({ ...editData, date_of_birth: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Sex</span>
                <select
                  value={editData.sex || ""}
                  onChange={(e) => onEditChange({ ...editData, sex: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">--</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Blood Type</span>
                <select
                  value={editData.blood_type || ""}
                  onChange={(e) => onEditChange({ ...editData, blood_type: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">--</option>
                  {["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((bt) => (
                    <option key={bt} value={bt}>{bt}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Phone</span>
                <input
                  type="tel"
                  value={editData.phone || ""}
                  onChange={(e) => onEditChange({ ...editData, phone: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Email</span>
                <input
                  type="email"
                  value={editData.email || ""}
                  onChange={(e) => onEditChange({ ...editData, email: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                <span className="text-sm font-medium">Address</span>
                <input
                  type="text"
                  value={editData.address || ""}
                  onChange={(e) => onEditChange({ ...editData, address: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                <span className="text-sm font-medium">Allergies</span>
                <input
                  type="text"
                  value={editData.allergies || ""}
                  onChange={(e) => onEditChange({ ...editData, allergies: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  placeholder="Comma separated"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Insurance Provider</span>
                <input
                  type="text"
                  value={editData.insurance_provider || ""}
                  onChange={(e) => onEditChange({ ...editData, insurance_provider: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Insurance Policy #</span>
                <input
                  type="text"
                  value={editData.insurance_policy_number || ""}
                  onChange={(e) => onEditChange({ ...editData, insurance_policy_number: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 sm:col-span-2 lg:col-span-3">
                <span className="text-sm font-medium">Notes</span>
                <textarea
                  value={editData.notes || ""}
                  onChange={(e) => onEditChange({ ...editData, notes: e.target.value })}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={2}
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={onSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="flex items-center gap-2 rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
