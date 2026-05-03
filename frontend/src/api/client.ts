import axios from "axios";

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
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export default api;
