import { useEffect, useState } from "react";
import api from "@/api/client";
import { Settings, Users, Database, Brain, Plus, Trash2, Save, Check } from "lucide-react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");

  const tabs = [
    { key: "general", label: "General", icon: Settings },
    { key: "llm", label: "LLM", icon: Brain },
    { key: "users", label: "Users", icon: Users },
    { key: "normalization", label: "Normalization", icon: Database },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div className="flex gap-1 rounded-lg border p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors ${
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "general" && <GeneralTab />}
      {activeTab === "llm" && <LlmTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "normalization" && <NormalizationTab />}
    </div>
  );
}

function GeneralTab() {
  const [settings, setSettings] = useState<any>(null);
  useEffect(() => {
    api.get("/settings").then((res) => setSettings(res.data));
  }, []);
  if (!settings) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <h3 className="font-medium">General Settings</h3>
      <InfoRow label="Vault Path" value={settings.vault?.root_path} />
      <InfoRow label="Inbox Path" value={settings.vault?.inbox_path} />
      <InfoRow label="OCR Engine" value={settings.ocr?.engine} />
      <InfoRow label="OCR Languages" value={settings.ocr?.language} />
      <InfoRow label="OCR Confidence Threshold" value={settings.ocr?.confidence_threshold} />
      <InfoRow label="Pipeline Watch" value={settings.pipeline?.watch_enabled ? "Enabled" : "Disabled"} />
    </div>
  );
}

function LlmTab() {
  const [settings, setSettings] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get("/settings").then((res) => {
      setSettings(res.data);
      setForm({
        llm_provider: res.data.llm.provider,
        ollama_base_url: res.data.llm.ollama_base_url,
        ollama_model: res.data.llm.ollama_model,
        claude_model: res.data.llm.claude_model,
        claude_api_key: "",
      });
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const updates: any = {};
    if (form.llm_provider !== settings.llm.provider) updates.llm_provider = form.llm_provider;
    if (form.ollama_base_url !== settings.llm.ollama_base_url) updates.ollama_base_url = form.ollama_base_url;
    if (form.ollama_model !== settings.llm.ollama_model) updates.ollama_model = form.ollama_model;
    if (form.claude_model !== settings.llm.claude_model) updates.claude_model = form.claude_model;
    if (form.claude_api_key) updates.claude_api_key = form.claude_api_key;

    if (Object.keys(updates).length > 0) {
      await api.patch("/settings", updates);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  };

  if (!settings) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">LLM Configuration</h3>

      <div className="grid gap-3 max-w-md">
        <label className="space-y-1">
          <span className="text-sm font-medium">Provider</span>
          <select
            value={form.llm_provider}
            onChange={(e) => setForm({ ...form, llm_provider: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="ollama">Ollama (Local)</option>
            <option value="claude">Claude API</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Ollama URL</span>
          <input
            type="text"
            value={form.ollama_base_url}
            onChange={(e) => setForm({ ...form, ollama_base_url: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Ollama Model</span>
          <input
            type="text"
            value={form.ollama_model}
            onChange={(e) => setForm({ ...form, ollama_model: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Claude Model</span>
          <input
            type="text"
            value={form.claude_model}
            onChange={(e) => setForm({ ...form, claude_model: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium">Claude API Key</span>
          <input
            type="password"
            value={form.claude_api_key}
            onChange={(e) => setForm({ ...form, claude_api_key: e.target.value })}
            placeholder={settings.llm.has_claude_key ? "configured" : "Not set"}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
        </label>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved" : saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "" });
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => {
    api.get("/settings/users").then((res) => setUsers(res.data));
    api.get("/patients").then((res) => setPatients(res.data));
  }, []);

  const createUser = async () => {
    await api.post("/settings/users", newUser);
    setNewUser({ username: "", password: "", display_name: "" });
    setShowCreate(false);
    const res = await api.get("/settings/users");
    setUsers(res.data);
  };

  const deleteUser = async (id: number) => {
    if (!confirm("Delete this user?")) return;
    await api.delete(`/settings/users/${id}`);
    setUsers(users.filter((u) => u.id !== id));
  };

  const grantAccess = async (userId: number, patientId: number) => {
    await api.post(`/settings/users/${userId}/access`, { patient_id: patientId, role: "viewer" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">User Management</h3>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3 max-w-md">
          <input
            type="text"
            placeholder="Username"
            value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="password"
            placeholder="Password"
            value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Display Name"
            value={newUser.display_name}
            onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
            className="w-full rounded-md border px-3 py-2 text-sm"
          />
          <button onClick={createUser} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
            Create
          </button>
        </div>
      )}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Username</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Grant Access</th>
              <th className="px-4 py-2 text-left font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.username}</td>
                <td className="px-4 py-2">{u.display_name}</td>
                <td className="px-4 py-2 text-muted-foreground">{u.created_at?.split("T")[0]}</td>
                <td className="px-4 py-2">
                  <select
                    className="rounded border px-2 py-1 text-xs"
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) grantAccess(u.id, Number(e.target.value));
                      e.target.value = "";
                    }}
                  >
                    <option value="">Grant patient...</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>{p.display_name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => deleteUser(u.id)}
                    className="rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NormalizationTab() {
  const [normType, setNormType] = useState("lab_tests");
  const [normItems, setNormItems] = useState<any[]>([]);
  const [normFilter, setNormFilter] = useState<string | null>(null);

  useEffect(() => {
    const params: Record<string, any> = {};
    if (normFilter) params.filter = normFilter;
    api.get(`/normalization/${normType}`, { params }).then((res) => {
      setNormItems(Array.isArray(res.data) ? res.data : []);
    });
  }, [normType, normFilter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <select
          value={normType}
          onChange={(e) => setNormType(e.target.value)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="lab_tests">Lab Tests</option>
          <option value="specialties">Specialties</option>
          <option value="diagnoses">Diagnoses</option>
          <option value="medications">Medications</option>
        </select>
        <select
          value={normFilter || ""}
          onChange={(e) => setNormFilter(e.target.value || null)}
          className="rounded-md border px-3 py-1.5 text-sm"
        >
          <option value="">All</option>
          <option value="unreviewed">Unreviewed only</option>
        </select>
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Canonical Code</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-left font-medium">Aliases</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {normItems.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  No items found
                </td>
              </tr>
            ) : (
              normItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2 font-mono text-xs">{item.canonical_code}</td>
                  <td className="px-4 py-2">{item.canonical_display}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {item.alias_count || 0} aliases
                    {item.unreviewed_count > 0 && (
                      <span className="ml-1 text-yellow-600">
                        ({item.unreviewed_count} unreviewed)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={async () => {
                        await api.post(`/normalization/${normType}/${item.id}/confirm`);
                        const params: Record<string, any> = {};
                        if (normFilter) params.filter = normFilter;
                        const res = await api.get(`/normalization/${normType}`, { params });
                        setNormItems(Array.isArray(res.data) ? res.data : []);
                      }}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-accent"
                    >
                      Confirm all
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value || "—"}</span>
    </div>
  );
}
