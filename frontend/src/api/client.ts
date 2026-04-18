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
      !error.config?.url?.includes("/auth/me") &&
      !error.config?.url?.includes("/oidc/") &&
      !error.config?.url?.includes("/setup/")
    ) {
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default api;
