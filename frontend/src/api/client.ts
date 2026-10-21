import axios from "axios";
import { installFourxxGuard } from "./fourxxBudget";

// Shared axios instance for all backend calls.
//
// - `withCredentials` forwards the session cookie.
// - `X-Requested-With` is required by the backend CSRF middleware on every
//   state-changing request; setting it globally means callers cannot forget.
//   The header also triggers a CORS preflight on cross-origin requests so a
//   malicious site cannot add it from a plain <form> submission.
const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

let redirectingToLogin = false;

api.interceptors.request.use((config) => {
  if (redirectingToLogin) {
    const err = new Error("Session expired; redirecting to login") as Error & {
      code: string;
      config: unknown;
    };
    err.code = "ERR_AUTH_REDIRECT";
    err.config = config;
    return Promise.reject(err);
  }
  return config;
});

api.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    if (
      error.response?.status === 401 &&
      !window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/setup") &&
      // The doctor share surface mounts under /share/* and uses a
      // separate cookie + axios client. The admin AuthProvider's
      // /auth/me probe fires there too (it wraps the whole app) and
      // 401s — without this guard we'd kick the doctor to the admin
      // login page on every share page load.
      !window.location.pathname.startsWith("/share") &&
      !error.config?.url?.includes("/auth/me") &&
      !error.config?.url?.includes("/oidc/") &&
      !error.config?.url?.includes("/setup/")
    ) {
      // Block everything else this page would still send (other polls,
      // parallel loads) until the browser leaves for /login: each would
      // only be another 401 toward the proxy's fail2ban threshold.
      redirectingToLogin = true;
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

installFourxxGuard(api);

export default api;
