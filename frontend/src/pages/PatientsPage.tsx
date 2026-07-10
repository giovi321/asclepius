import { useState } from "react";
import api from "@/api/client";
import { Plus, Trash2, ChevronDown, ChevronUp, Save, X, Users } from "lucide-react";
import { useToast } from "@/contexts/ToastContext";
import { useConfirm } from "@/contexts/ConfirmContext";
import { usePatients } from "@/hooks/data";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonRows } from "@/components/ui/Skeleton";
import type { Patient, PatientCreate } from "@/types";

export default function PatientsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = usePatients();
  const patients: Patient[] = Array.isArray(data) ? data : [];
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Patient>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [newPatient, setNewPatient] = useState<Partial<Patient>>({});
  const [saving, setSaving] = useState(false);

  const loadPatients = () => refetch();

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
      toast({ title: "Failed to save patient", variant: "error" });
    }
    setSaving(false);
  };

  const handleDelete = async (id: number) => {
    const ok = await confirm({
      title: "Delete patient?",
      description:
        "All documents, lab results, and medical events for this patient will also be removed. This cannot be undone.",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await api.delete(`/patients/${id}`);
      await loadPatients();
      if (expandedId === id) {
        setExpandedId(null);
        setEditData({});
      }
    } catch {
      toast({ title: "Failed to delete patient", variant: "error" });
    }
  };

  const handleCreate = async () => {
    if (!newPatient.display_name?.trim()) return;
    setSaving(true);
    try {
      const body: PatientCreate = {
        display_name: newPatient.display_name?.trim() ?? "",
        date_of_birth: newPatient.date_of_birth || null,
        sex: newPatient.sex || null,
      };
      await api.post("/patients", body);
      setNewPatient({});
      setShowCreate(false);
      await loadPatients();
    } catch {
      toast({ title: "Failed to create patient", variant: "error" });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="md" onClick={() => setShowCreate(!showCreate)}>
          <Plus className="h-4 w-4" />
          New Patient
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border p-4 space-y-4">
          <h3 className="font-medium">Create New Patient</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-sm font-medium">Full Name *</span>
              <Input
                type="text"
                value={newPatient.display_name || ""}
                onChange={(e) =>
                  setNewPatient({ ...newPatient, display_name: e.target.value })
                }
                autoFocus
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Date of Birth</span>
              <Input
                type="date"
                value={newPatient.date_of_birth || ""}
                onChange={(e) =>
                  setNewPatient({
                    ...newPatient,
                    date_of_birth: e.target.value,
                  })
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Sex</span>
              <Select
                value={newPatient.sex || ""}
                onChange={(e) =>
                  setNewPatient({ ...newPatient, sex: e.target.value })
                }
              >
                <option value="">--</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </Select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="md"
              onClick={handleCreate}
              loading={saving}
              disabled={!newPatient.display_name?.trim()}
            >
              {!saving && <Save className="h-4 w-4" />}
              {saving ? "Creating..." : "Create Patient"}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setShowCreate(false);
                setNewPatient({});
              }}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-surface">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Date of Birth</th>
              <th className="px-4 py-2 text-left font-medium">Sex</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr>
                <td colSpan={4}>
                  <SkeletonRows rows={4} cols={3} />
                </td>
              </tr>
            ) : patients.length === 0 ? (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    icon={Users}
                    title="No patients found"
                    description="Create a patient to start filing documents and lab results against them."
                  />
                </td>
              </tr>
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
        <td className="px-4 py-2 coarse:py-3 font-medium">
          {patient.display_name}
        </td>
        <td className="px-4 py-2 coarse:py-3 text-muted-foreground">
          {patient.date_of_birth || "--"}
        </td>
        <td className="px-4 py-2 coarse:py-3 text-muted-foreground">
          {patient.sex || "--"}
        </td>
        <td className="px-4 py-2 coarse:py-3">
          <div className="flex items-center gap-1">
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-muted/20 px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-3 max-w-4xl">
              <label className="space-y-1">
                <span className="text-sm font-medium">Full Name</span>
                <Input
                  type="text"
                  value={editData.display_name || ""}
                  onChange={(e) =>
                    onEditChange({ ...editData, display_name: e.target.value })
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Date of Birth</span>
                <Input
                  type="date"
                  value={editData.date_of_birth || ""}
                  onChange={(e) =>
                    onEditChange({ ...editData, date_of_birth: e.target.value })
                  }
                />
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Sex</span>
                <Select
                  value={editData.sex || ""}
                  onChange={(e) =>
                    onEditChange({ ...editData, sex: e.target.value })
                  }
                >
                  <option value="">--</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </Select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="md" onClick={onSave} loading={saving}>
                {!saving && <Save className="h-4 w-4" />}
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="border-destructive/30 text-destructive hover:bg-destructive-soft active:bg-destructive-soft"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
