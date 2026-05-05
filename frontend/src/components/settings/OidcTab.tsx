import { useEffect, useState } from "react";
import {
  SettingsForm,
  TextField,
  ToggleField,
  useSettingsSave,
} from "./SettingsFormHelpers";
import { useSettings } from "@/hooks/data";

const parseRoleList = (v: string): string[] =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export default function OidcTab() {
  const [s, setS] = useState<any>(null);
  const [f, setF] = useState<any>({});
  const { saving, saved, save } = useSettingsSave();
  const { data: settingsData } = useSettings();

  useEffect(() => {
    if (!settingsData) return;
    setS(settingsData);
    setF({
      oidc_enabled: settingsData.oidc.enabled,
      oidc_provider_url: settingsData.oidc.provider_url || "",
      oidc_client_id: settingsData.oidc.client_id || "",
      oidc_client_secret: "",
      oidc_scopes: settingsData.oidc.scopes || "openid profile email",
      oidc_auto_create_user: settingsData.oidc.auto_create_user,
      oidc_username_claim:
        settingsData.oidc.username_claim || "preferred_username",
      oidc_display_name_claim: settingsData.oidc.display_name_claim || "name",
      oidc_sync_roles: !!settingsData.oidc.sync_roles,
      oidc_roles_claim: settingsData.oidc.roles_claim || "groups",
      oidc_admin_roles: (settingsData.oidc.admin_roles || []).join(", "),
      oidc_editor_roles: (settingsData.oidc.editor_roles || []).join(", "),
      oidc_viewer_roles: (settingsData.oidc.viewer_roles || []).join(", "),
      oidc_default_role: settingsData.oidc.default_role || "viewer",
    });
  }, [settingsData]);

  if (!s) return <div className="text-muted-foreground">Loading...</div>;

  const admin = parseRoleList(f.oidc_admin_roles || "");
  const editor = parseRoleList(f.oidc_editor_roles || "");
  const viewer = parseRoleList(f.oidc_viewer_roles || "");

  return (
    <SettingsForm
      title="OIDC / SSO (Authentik, Keycloak, etc.)"
      saving={saving}
      saved={saved}
      onSave={() =>
        save({
          oidc_enabled:
            f.oidc_enabled !== s.oidc.enabled ? f.oidc_enabled : undefined,
          oidc_provider_url:
            f.oidc_provider_url !== (s.oidc.provider_url || "")
              ? f.oidc_provider_url
              : undefined,
          oidc_client_id:
            f.oidc_client_id !== (s.oidc.client_id || "")
              ? f.oidc_client_id
              : undefined,
          oidc_client_secret: f.oidc_client_secret || undefined,
          oidc_scopes:
            f.oidc_scopes !== (s.oidc.scopes || "") ? f.oidc_scopes : undefined,
          oidc_auto_create_user:
            f.oidc_auto_create_user !== s.oidc.auto_create_user
              ? f.oidc_auto_create_user
              : undefined,
          oidc_username_claim:
            f.oidc_username_claim !== (s.oidc.username_claim || "")
              ? f.oidc_username_claim
              : undefined,
          oidc_display_name_claim:
            f.oidc_display_name_claim !== (s.oidc.display_name_claim || "")
              ? f.oidc_display_name_claim
              : undefined,
          oidc_sync_roles:
            f.oidc_sync_roles !== !!s.oidc.sync_roles
              ? f.oidc_sync_roles
              : undefined,
          oidc_roles_claim:
            f.oidc_roles_claim !== (s.oidc.roles_claim || "")
              ? f.oidc_roles_claim
              : undefined,
          oidc_admin_roles: arraysEqual(admin, s.oidc.admin_roles || [])
            ? undefined
            : admin,
          oidc_editor_roles: arraysEqual(editor, s.oidc.editor_roles || [])
            ? undefined
            : editor,
          oidc_viewer_roles: arraysEqual(viewer, s.oidc.viewer_roles || [])
            ? undefined
            : viewer,
          oidc_default_role:
            f.oidc_default_role !== (s.oidc.default_role || "")
              ? f.oidc_default_role
              : undefined,
        })
      }
    >
      <ToggleField
        label="Enable OIDC"
        value={f.oidc_enabled}
        onChange={(v) => setF({ ...f, oidc_enabled: v })}
        description="Show 'Sign in with SSO' on the login page"
      />
      <TextField
        label="Provider URL"
        value={f.oidc_provider_url}
        onChange={(v) => setF({ ...f, oidc_provider_url: v })}
        placeholder="https://auth.example.com/application/o/asclepius/"
      />
      <TextField
        label="Client ID"
        value={f.oidc_client_id}
        onChange={(v) => setF({ ...f, oidc_client_id: v })}
      />
      <TextField
        label="Client Secret"
        value={f.oidc_client_secret}
        onChange={(v) => setF({ ...f, oidc_client_secret: v })}
        type="password"
        placeholder={s.oidc.has_client_secret ? "configured" : "Not set"}
      />
      <TextField
        label="Scopes"
        value={f.oidc_scopes}
        onChange={(v) => setF({ ...f, oidc_scopes: v })}
        description="Add 'groups' when syncing roles so the provider returns group membership"
      />
      <ToggleField
        label="Auto-create Users"
        value={f.oidc_auto_create_user}
        onChange={(v) => setF({ ...f, oidc_auto_create_user: v })}
        description="Create a local user on first OIDC login"
      />
      <TextField
        label="Username Claim"
        value={f.oidc_username_claim}
        onChange={(v) => setF({ ...f, oidc_username_claim: v })}
        placeholder="preferred_username"
      />
      <TextField
        label="Display Name Claim"
        value={f.oidc_display_name_claim}
        onChange={(v) => setF({ ...f, oidc_display_name_claim: v })}
        placeholder="name"
      />

      <div className="pt-2 border-t">
        <h4 className="text-sm font-semibold mb-2">Role sync</h4>
        <p className="text-xs text-muted-foreground mb-3">
          When enabled, a user's local role is recomputed on every OIDC login
          from the provider's group/role claim. First match wins in the order
          admin, editor, viewer.
        </p>
      </div>
      <ToggleField
        label="Sync roles on login"
        value={f.oidc_sync_roles}
        onChange={(v) => setF({ ...f, oidc_sync_roles: v })}
        description="Overwrite the local role from OIDC groups on every login"
      />
      <TextField
        label="Roles claim"
        value={f.oidc_roles_claim}
        onChange={(v) => setF({ ...f, oidc_roles_claim: v })}
        placeholder="groups"
        description="Dotted path. Authentik: 'groups'. Keycloak realm roles: 'realm_access.roles'."
      />
      <TextField
        label="Admin groups"
        value={f.oidc_admin_roles}
        onChange={(v) => setF({ ...f, oidc_admin_roles: v })}
        placeholder="asclepius-admins"
        description="Comma-separated list of OIDC group/role names that map to admin"
      />
      <TextField
        label="Editor groups"
        value={f.oidc_editor_roles}
        onChange={(v) => setF({ ...f, oidc_editor_roles: v })}
        placeholder="asclepius-editors"
        description="Comma-separated list of OIDC group/role names that map to editor"
      />
      <TextField
        label="Viewer groups"
        value={f.oidc_viewer_roles}
        onChange={(v) => setF({ ...f, oidc_viewer_roles: v })}
        placeholder="asclepius-viewers"
        description="Comma-separated list of OIDC group/role names that map to viewer"
      />
      <TextField
        label="Default role"
        value={f.oidc_default_role}
        onChange={(v) => setF({ ...f, oidc_default_role: v })}
        placeholder="viewer"
        description="Applied when sync is on and no mapping matches. Use admin, editor, or viewer."
      />
    </SettingsForm>
  );
}
