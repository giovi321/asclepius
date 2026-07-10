import { useLocation, useNavigate } from "react-router-dom";
import OidcTab from "./OidcTab";
import UsersTab from "./UsersTab";
import SessionsTab from "./SessionsTab";

const SUB_TABS = [
  { key: "oidc", label: "OIDC / SSO" },
  { key: "users", label: "Users" },
  { key: "sessions", label: "Sessions" },
] as const;

type SubTab = (typeof SUB_TABS)[number]["key"];
const SUB_KEYS: readonly SubTab[] = SUB_TABS.map((t) => t.key);
const DEFAULT_SUB: SubTab = "oidc";

function isSubTab(v: string | undefined): v is SubTab {
  return !!v && (SUB_KEYS as readonly string[]).includes(v);
}

export default function AccessTab() {
  const location = useLocation();
  const navigate = useNavigate();
  const segments = location.pathname.split("/").filter(Boolean); // ['settings', 'access', subtab?, ...]
  const slug = segments[2];
  const subTab: SubTab = isSubTab(slug) ? slug : DEFAULT_SUB;

  const setSubTab = (key: SubTab) => {
    navigate(`/settings/access/${key}`, { replace: false });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-6 border-b text-sm overflow-x-auto overflow-y-hidden">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`whitespace-nowrap border-b-2 -mb-px px-1 py-2 transition-colors coarse:min-h-11 ${
              subTab === t.key
                ? "border-primary/60 text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "oidc" && <OidcTab />}
      {subTab === "users" && <UsersTab />}
      {subTab === "sessions" && <SessionsTab />}
    </div>
  );
}
