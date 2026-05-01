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

// We deliberately do NOT do a window.location redirect on 401 here.
// An earlier version did `window.location.href = "/share/{firstSegment}"`
// which on the landing page (/share/{token}) redirects to the same URL
// we're already on, producing an infinite refresh loop. On /share/dashboard
// it does the same.
//
// The ShareSessionProvider's React effect handles the "session missing"
// case correctly: it sets ``me = null`` (so the page can render an
// inline state) and uses react-router's ``navigate("/share")`` for the
// deep-link fallback, which is a soft route change with no reload.
shareApi.interceptors.response.use(
  (response: any) => response,
  (error: any) => Promise.reject(error),
);

export default shareApi;
