import { useEffect, useState } from "react";
import api from "@/api/client";
import { SettingsForm, TextField, ToggleField, useSettingsSave } from "./SettingsFormHelpers";

export default function OidcTab() {
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
