import axios from "axios";

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
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
