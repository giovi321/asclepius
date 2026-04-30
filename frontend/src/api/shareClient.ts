import axios from "axios";

// Dedicated axios instance for the doctor-share surface.
//
// Separate from the regular `client.ts` because:
// - the share session uses a *different* cookie (`asclepius_share`) on a
//   different path scope (`/api/share`), so we never want a regular login
//   cookie to ride along on these requests, and vice versa.
// - the 401 redirect target is different — share 401s should drop the
//   doctor back at the share landing page (where they can re-OTP), not at
//   the admin login page they don't have credentials for.
//
// `withCredentials` is still required so the browser includes the share
// cookie. `X-Requested-With` is required by the backend CSRF middleware
// once a share session exists.
const shareApi = axios.create({
  baseURL: "/api/share",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
  },
});

shareApi.interceptors.response.use(
  (response: any) => response,
  (error: any) => {
    if (
      error.response?.status === 401 &&
      window.location.pathname.startsWith("/share/") &&
      // Don't redirect on the OTP verify call itself — the page renders
      // its own error message.
      !error.config?.url?.endsWith("/verify-otp") &&
      !error.config?.url?.endsWith("/request-otp")
    ) {
      // Strip any deep `/share/documents/...` path back to the landing
      // page; the doctor will need to re-enter the OTP.
      const m = window.location.pathname.match(/^\/share\/[^/]+/);
      window.location.href = m ? m[0] : "/share";
    }
    return Promise.reject(error);
  },
);

export default shareApi;
