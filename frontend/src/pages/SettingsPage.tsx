import { useEffect, useState } from "react";
import api from "@/api/client";
import { Settings, Users, Database, Brain } from "lucide-react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("general");
  const [settings, setSettings] = useState<any>(null);
  const [normType, setNormType] = useState("lab_tests");
  const [normItems, setNormItems] = useState<any[]>([]);
  const [normFilter, setNormFilter] = useState<string | null>(null);

  useEffect(() => {
    api.get("/settings").then((res) => setSettings(res.data));
  }, []);

  useEffect(() => {
    if (activeTab === "normalization") {
      const params: Record<string, any> = {};
      if (normFilter) params.filter = normFilter;
      api.get(`/normalization/${normType}`, { params }).then((res) => {
        setNormItems(Array.isArray(res.data) ? res.data : []);
      });
    }
  }, [activeTab, normType, normFilter]);

  const tabs = [
    { key: "general", label: "General", icon: Settings },
    { key: "llm", label: "LLM", icon: Brain },
    { key: "normalization", label: "Normalization", icon: Database },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Tabs */}
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

      {/* General */}
      {activeTab === "general" && settings && (
        <div className="rounded-lg border p-4 space-y-3">
          <h3 className="font-medium">General Settings</h3>
          <InfoRow label="Vault Path" value={settings.vault?.root_path} />
          <InfoRow label="Inbox Path" value={settings.vault?.inbox_path} />
          <InfoRow label="OCR Engine" value={settings.ocr?.engine} />
          <InfoRow label="OCR Languages" value={settings.ocr?.language} />
          <InfoRow label="OCR Confidence Threshold" value={settings.ocr?.confidence_threshold} />
          <InfoRow label="Pipeline Watch" value={settings.pipeline?.watch_enabled ? "Enabled" : "Disabled"} />
        </div>
      )}

      {/* LLM */}
      {activeTab === "llm" && settings && (
        <div className="rounded-lg border p-4 space-y-3">
          <h3 className="font-medium">LLM Configuration</h3>
          <InfoRow label="Provider" value={settings.llm?.provider} />
          <InfoRow label="Ollama URL" value={settings.llm?.ollama_base_url} />
          <InfoRow label="Ollama Model" value={settings.llm?.ollama_model} />
          <InfoRow label="Claude Model" value={settings.llm?.claude_model} />
          <InfoRow label="Claude API Key" value={settings.llm?.has_claude_key ? "Configured" : "Not set"} />
          <p className="text-xs text-muted-foreground mt-2">
            To change LLM settings, edit config/settings.yaml and restart the application.
          </p>
        </div>
      )}

      {/* Normalization */}
      {activeTab === "normalization" && (
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
                            setNormFilter(normFilter); // trigger reload
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
      )}
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
