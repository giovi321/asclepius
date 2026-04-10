import { useEffect, useState } from "react";
import api from "@/api/client";
import { Users, Database, Brain, Eye, Shield, Workflow, Plus, Trash2, Save, Check } from "lucide-react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("llm");

  const tabs = [
    { key: "llm", label: "LLM", icon: Brain },
    { key: "ocr", label: "OCR", icon: Eye },
    { key: "pipeline", label: "Pipeline", icon: Workflow },
    { key: "oidc", label: "OIDC / SSO", icon: Shield },
    { key: "users", label: "Users", icon: Users },
    { key: "normalization", label: "Normalization", icon: Database },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                activeTab === tab.key ? "bg-primary text-primary-foreground" : "hover:bg-accent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "llm" && <LlmTab />}
      {activeTab === "ocr" && <OcrTab />}
      {activeTab === "pipeline" && <PipelineTab />}
      {activeTab === "oidc" && <OidcTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "normalization" && <NormalizationTab />}
    </div>
  );
}

// --- Generic settings form helpers ---

function SettingsForm({ title, children, onSave, saving, saved }: {
  title: string; children: React.ReactNode;
  onSave: () => void; saving: boolean; saved: boolean;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-4">
      <h3 className="font-medium">{title}</h3>
      <div className="grid gap-4 max-w-lg">{children}</div>
      <button
        onClick={onSave}
        disabled={saving}
        className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? "Saved" : saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

function TextField({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
    </label>
  );
}

function NumberField({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min} max={max} step={step} className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm">
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ToggleField({ label, value, onChange, description }: {
  label: string; value: boolean; onChange: (v: boolean) => void; description?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <span className="text-sm font-medium">{label}</span>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <button onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${value ? "bg-primary" : "bg-muted"}`}>
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${value ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

// --- Tabs ---

function useSettingsSave() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const save = async (updates: Record<string, any>) => {
    setSaving(true);
    try {
      const filtered = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined && v !== ""));
      if (Object.keys(filtered).length > 0) {
        await api.patch("/settings", filtered);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch { alert("Failed to save settings"); }
    setSaving(false);
  };
  return { saving, saved, save };
}

function LlmTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        llm_provider: res.data.llm.provider,
        ollama_base_url: res.data.llm.ollama_base_url,
        ollama_model: res.data.llm.ollama_model,
        claude_model: res.data.llm.claude_model,
        claude_api_key: "",
        extraction_timeout: res.data.llm.extraction_timeout,
      });
    });
  }, []);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <SettingsForm title="LLM Configuration" saving={saving} saved={saved}
      onSave={() => save({
        llm_provider: f.llm_provider !== s.llm.provider ? f.llm_provider : undefined,
        ollama_base_url: f.ollama_base_url !== s.llm.ollama_base_url ? f.ollama_base_url : undefined,
        ollama_model: f.ollama_model !== s.llm.ollama_model ? f.ollama_model : undefined,
        claude_model: f.claude_model !== s.llm.claude_model ? f.claude_model : undefined,
        claude_api_key: f.claude_api_key || undefined,
        extraction_timeout: f.extraction_timeout !== s.llm.extraction_timeout ? f.extraction_timeout : undefined,
      })}>
      <SelectField label="Provider" value={f.llm_provider} onChange={(v) => setF({ ...f, llm_provider: v })}
        options={[{ value: "ollama", label: "Ollama (Local)" }, { value: "claude", label: "Claude API" }]} />
      <TextField label="Ollama URL" value={f.ollama_base_url} onChange={(v) => setF({ ...f, ollama_base_url: v })} />
      <TextField label="Ollama Model" value={f.ollama_model} onChange={(v) => setF({ ...f, ollama_model: v })}
        placeholder="e.g. llama3.1" />
      <TextField label="Claude Model" value={f.claude_model} onChange={(v) => setF({ ...f, claude_model: v })} />
      <TextField label="Claude API Key" value={f.claude_api_key} onChange={(v) => setF({ ...f, claude_api_key: v })}
        type="password" placeholder={s.llm.has_claude_key ? "configured" : "Not set"} />
      <NumberField label="Extraction Timeout (seconds)" value={f.extraction_timeout}
        onChange={(v) => setF({ ...f, extraction_timeout: v })} min={30} max={600} step={10} />
    </SettingsForm>
  );
}

function OcrTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        ocr_engine: res.data.ocr.engine,
        ocr_language: res.data.ocr.language,
        ocr_confidence_threshold: res.data.ocr.confidence_threshold,
        cloud_ocr_enabled: res.data.ocr.cloud_ocr_enabled,
        ocr_remote_url: res.data.ocr.remote_url || "",
        ocr_remote_api_key: "",
        llm_vision_provider: res.data.ocr.llm_vision_provider || "",
        llm_vision_model: res.data.ocr.llm_vision_model || "",
        llm_vision_ollama_url: res.data.ocr.llm_vision_ollama_url || "",
        google_vision_key: "",
      });
    });
  }, []);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <SettingsForm title="OCR Configuration" saving={saving} saved={saved}
      onSave={() => save({
        ocr_engine: f.ocr_engine !== s.ocr.engine ? f.ocr_engine : undefined,
        ocr_language: f.ocr_language !== s.ocr.language ? f.ocr_language : undefined,
        ocr_confidence_threshold: f.ocr_confidence_threshold !== s.ocr.confidence_threshold ? f.ocr_confidence_threshold : undefined,
        cloud_ocr_enabled: f.cloud_ocr_enabled !== s.ocr.cloud_ocr_enabled ? f.cloud_ocr_enabled : undefined,
        ocr_remote_url: f.ocr_remote_url !== (s.ocr.remote_url || "") ? f.ocr_remote_url : undefined,
        ocr_remote_api_key: f.ocr_remote_api_key || undefined,
        llm_vision_provider: f.llm_vision_provider !== (s.ocr.llm_vision_provider || "") ? f.llm_vision_provider : undefined,
        llm_vision_model: f.llm_vision_model !== (s.ocr.llm_vision_model || "") ? f.llm_vision_model : undefined,
        llm_vision_ollama_url: f.llm_vision_ollama_url !== (s.ocr.llm_vision_ollama_url || "") ? f.llm_vision_ollama_url : undefined,
        google_vision_key: f.google_vision_key || undefined,
      })}>
      <SelectField label="OCR Engine" value={f.ocr_engine} onChange={(v) => setF({ ...f, ocr_engine: v })}
        options={[
          { value: "tesseract", label: "Tesseract (Local)" },
          { value: "tesseract_remote", label: "Tesseract (Remote Server)" },
          { value: "llm_vision", label: "LLM Vision (AI reads images)" },
          { value: "google_vision", label: "Google Cloud Vision" },
        ]} />
      <TextField label="OCR Languages" value={f.ocr_language} onChange={(v) => setF({ ...f, ocr_language: v })}
        placeholder="e.g. eng+ita+deu" />
      <NumberField label="Confidence Threshold" value={f.ocr_confidence_threshold}
        onChange={(v) => setF({ ...f, ocr_confidence_threshold: v })} min={0} max={1} step={0.05} />

      {f.ocr_engine === "tesseract_remote" && (
        <>
          <TextField label="Remote OCR URL" value={f.ocr_remote_url}
            onChange={(v) => setF({ ...f, ocr_remote_url: v })} placeholder="http://ocr-server:8080/ocr" />
          <TextField label="Remote OCR API Key" value={f.ocr_remote_api_key}
            onChange={(v) => setF({ ...f, ocr_remote_api_key: v })} type="password"
            placeholder={s.ocr.has_remote_api_key ? "configured" : "Not set"} />
        </>
      )}

      {f.ocr_engine === "llm_vision" && (
        <>
          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Vision OCR can use a <strong>different provider and model</strong> than the extraction LLM.
            For example: Chandra for OCR + llama3.1 for extraction.
            Leave fields empty to use the same provider/model as the LLM tab.
          </div>
          <SelectField label="Vision Provider" value={f.llm_vision_provider}
            onChange={(v) => setF({ ...f, llm_vision_provider: v })}
            options={[
              { value: "", label: "Same as LLM tab" },
              { value: "ollama", label: "Ollama" },
              { value: "claude", label: "Claude" },
            ]} />
          <TextField label="Vision Model" value={f.llm_vision_model}
            onChange={(v) => setF({ ...f, llm_vision_model: v })}
            placeholder="e.g. fredrezones55/chandra-ocr-2, llama3.2-vision" />
          {(f.llm_vision_provider === "ollama" || (!f.llm_vision_provider && s.llm.provider === "ollama")) && (
            <TextField label="Vision Ollama URL" value={f.llm_vision_ollama_url}
              onChange={(v) => setF({ ...f, llm_vision_ollama_url: v })}
              placeholder="Same as LLM Ollama URL if empty" />
          )}
        </>
      )}

      {f.ocr_engine === "google_vision" && (
        <TextField label="Google Vision API Key" value={f.google_vision_key}
          onChange={(v) => setF({ ...f, google_vision_key: v })} type="password"
          placeholder={s.ocr.has_google_vision_key ? "configured" : "Not set"} />
      )}

      <ToggleField label="Cloud OCR Fallback" value={f.cloud_ocr_enabled}
        onChange={(v) => setF({ ...f, cloud_ocr_enabled: v })}
        description="Use cloud OCR when local confidence is below threshold" />
    </SettingsForm>
  );
}

function PipelineTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        pipeline_watch_enabled: res.data.pipeline.watch_enabled,
        pipeline_poll_interval: res.data.pipeline.poll_interval_seconds,
        pipeline_retry_interval: res.data.pipeline.retry_interval_seconds,
        pipeline_max_retries: res.data.pipeline.max_retries,
        session_ttl_hours: res.data.auth.session_ttl_hours,
      });
    });
  }, []);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <SettingsForm title="Pipeline & Auth" saving={saving} saved={saved}
      onSave={() => save({
        pipeline_watch_enabled: f.pipeline_watch_enabled !== s.pipeline.watch_enabled ? f.pipeline_watch_enabled : undefined,
        pipeline_poll_interval: f.pipeline_poll_interval !== s.pipeline.poll_interval_seconds ? f.pipeline_poll_interval : undefined,
        pipeline_retry_interval: f.pipeline_retry_interval !== s.pipeline.retry_interval_seconds ? f.pipeline_retry_interval : undefined,
        pipeline_max_retries: f.pipeline_max_retries !== s.pipeline.max_retries ? f.pipeline_max_retries : undefined,
        session_ttl_hours: f.session_ttl_hours !== s.auth.session_ttl_hours ? f.session_ttl_hours : undefined,
      })}>
      <ToggleField label="Pipeline Watch" value={f.pipeline_watch_enabled}
        onChange={(v) => setF({ ...f, pipeline_watch_enabled: v })}
        description="Automatically process files dropped into the inbox" />
      <NumberField label="Poll Interval (seconds)" value={f.pipeline_poll_interval}
        onChange={(v) => setF({ ...f, pipeline_poll_interval: v })} min={1} max={60} step={1} />
      <NumberField label="Retry Interval (seconds)" value={f.pipeline_retry_interval}
        onChange={(v) => setF({ ...f, pipeline_retry_interval: v })} min={60} max={3600} step={60} />
      <NumberField label="Max Retries" value={f.pipeline_max_retries}
        onChange={(v) => setF({ ...f, pipeline_max_retries: v })} min={0} max={10} step={1} />
      <NumberField label="Session TTL (hours)" value={f.session_ttl_hours}
        onChange={(v) => setF({ ...f, session_ttl_hours: v })} min={1} max={8760} step={1} />
    </SettingsForm>
  );
}

function OidcTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();

  useEffect(() => {
    api.get("/settings").then((res) => {
      setS(res.data);
      setF({
        oidc_enabled: res.data.oidc.enabled,
        oidc_provider_url: res.data.oidc.provider_url || "",
        oidc_client_id: res.data.oidc.client_id || "",
        oidc_client_secret: "",
        oidc_scopes: res.data.oidc.scopes || "openid profile email",
        oidc_auto_create_user: res.data.oidc.auto_create_user,
        oidc_username_claim: res.data.oidc.username_claim || "preferred_username",
        oidc_display_name_claim: res.data.oidc.display_name_claim || "name",
      });
    });
  }, []);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <SettingsForm title="OIDC / SSO (Authentik, Keycloak, etc.)" saving={saving} saved={saved}
      onSave={() => save({
        oidc_enabled: f.oidc_enabled !== s.oidc.enabled ? f.oidc_enabled : undefined,
        oidc_provider_url: f.oidc_provider_url !== (s.oidc.provider_url || "") ? f.oidc_provider_url : undefined,
        oidc_client_id: f.oidc_client_id !== (s.oidc.client_id || "") ? f.oidc_client_id : undefined,
        oidc_client_secret: f.oidc_client_secret || undefined,
        oidc_scopes: f.oidc_scopes !== (s.oidc.scopes || "") ? f.oidc_scopes : undefined,
        oidc_auto_create_user: f.oidc_auto_create_user !== s.oidc.auto_create_user ? f.oidc_auto_create_user : undefined,
        oidc_username_claim: f.oidc_username_claim !== (s.oidc.username_claim || "") ? f.oidc_username_claim : undefined,
        oidc_display_name_claim: f.oidc_display_name_claim !== (s.oidc.display_name_claim || "") ? f.oidc_display_name_claim : undefined,
      })}>
      <ToggleField label="Enable OIDC" value={f.oidc_enabled} onChange={(v) => setF({ ...f, oidc_enabled: v })}
        description="Show 'Sign in with SSO' on the login page" />
      <TextField label="Provider URL" value={f.oidc_provider_url} onChange={(v) => setF({ ...f, oidc_provider_url: v })}
        placeholder="https://auth.example.com/application/o/asclepius/" />
      <TextField label="Client ID" value={f.oidc_client_id} onChange={(v) => setF({ ...f, oidc_client_id: v })} />
      <TextField label="Client Secret" value={f.oidc_client_secret} onChange={(v) => setF({ ...f, oidc_client_secret: v })}
        type="password" placeholder={s.oidc.has_client_secret ? "configured" : "Not set"} />
      <TextField label="Scopes" value={f.oidc_scopes} onChange={(v) => setF({ ...f, oidc_scopes: v })} />
      <ToggleField label="Auto-create Users" value={f.oidc_auto_create_user}
        onChange={(v) => setF({ ...f, oidc_auto_create_user: v })}
        description="Create a local user on first OIDC login" />
      <TextField label="Username Claim" value={f.oidc_username_claim}
        onChange={(v) => setF({ ...f, oidc_username_claim: v })} placeholder="preferred_username" />
      <TextField label="Display Name Claim" value={f.oidc_display_name_claim}
        onChange={(v) => setF({ ...f, oidc_display_name_claim: v })} placeholder="name" />
    </SettingsForm>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", display_name: "" });
  const [patients, setPatients] = useState<any[]>([]);

  useEffect(() => {
    api.get("/settings/users").then((res) => setUsers(res.data));
    api.get("/patients").then((res) => setPatients(Array.isArray(res.data) ? res.data : []));
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
        <button onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Add User
        </button>
      </div>

      {showCreate && (
        <div className="rounded-lg border p-4 space-y-3 max-w-md">
          <input type="text" placeholder="Username" value={newUser.username}
            onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="password" placeholder="Password" value={newUser.password}
            onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <input type="text" placeholder="Display Name" value={newUser.display_name}
            onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm" />
          <button onClick={createUser} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Create</button>
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
                  <select className="rounded border bg-background px-2 py-1 text-xs" defaultValue=""
                    onChange={(e) => { if (e.target.value) grantAccess(u.id, Number(e.target.value)); e.target.value = ""; }}>
                    <option value="">Grant patient...</option>
                    {patients.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <button onClick={() => deleteUser(u.id)} className="rounded p-1 text-muted-foreground hover:text-destructive">
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
        <select value={normType} onChange={(e) => setNormType(e.target.value)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm">
          <option value="lab_tests">Lab Tests</option>
          <option value="specialties">Specialties</option>
          <option value="diagnoses">Diagnoses</option>
          <option value="medications">Medications</option>
        </select>
        <select value={normFilter || ""} onChange={(e) => setNormFilter(e.target.value || null)}
          className="rounded-md border bg-background px-3 py-1.5 text-sm">
          <option value="">All</option>
          <option value="unreviewed">Unreviewed only</option>
        </select>
      </div>
      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Code</th>
              <th className="px-4 py-2 text-left font-medium">Display Name</th>
              <th className="px-4 py-2 text-left font-medium">Aliases</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {normItems.length === 0 ? (
              <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">No items found</td></tr>
            ) : normItems.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-2 font-mono text-xs">{item.canonical_code}</td>
                <td className="px-4 py-2">{item.canonical_display}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {item.alias_count || 0} aliases
                  {item.unreviewed_count > 0 && <span className="ml-1 text-yellow-600">({item.unreviewed_count} unreviewed)</span>}
                </td>
                <td className="px-4 py-2">
                  <button onClick={async () => {
                    await api.post(`/normalization/${normType}/${item.id}/confirm`);
                    const params: Record<string, any> = {};
                    if (normFilter) params.filter = normFilter;
                    const res = await api.get(`/normalization/${normType}`, { params });
                    setNormItems(Array.isArray(res.data) ? res.data : []);
                  }} className="rounded-md border px-2 py-1 text-xs hover:bg-accent">Confirm all</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
