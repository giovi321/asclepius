import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/api/client";
import { Shield } from "lucide-react";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [hidePasswordLogin, setHidePasswordLogin] = useState(false);
  const { login, user, needsSetup } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get("/auth/oidc/enabled")
      .then((res) => {
        setOidcEnabled(res.data.enabled);
        setHidePasswordLogin(!!res.data.hide_password_login);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (needsSetup) navigate("/setup");
    else if (user) navigate("/");
  }, [user, needsSetup, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      navigate("/");
    } catch {
      setError("Invalid username or password");
    } finally {
      setLoading(false);
    }
  };

  const handleOidcLogin = () => {
    window.location.href = "/api/auth/oidc/login";
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <img
            src="/logo.svg"
            alt="Asclepius"
            className="h-12 w-12 rounded-lg"
          />
          <h1 className="text-2xl font-semibold">Asclepius</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to your medical records
          </p>
        </div>

        {oidcEnabled && (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="mb-4 w-full"
              onClick={handleOidcLogin}
            >
              <Shield className="h-4 w-4" />
              Sign in with SSO
            </Button>
            {!hidePasswordLogin && (
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-2 text-xs text-muted-foreground">
                    or
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {!hidePasswordLogin && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Username
              </label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Password
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={loading}
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
