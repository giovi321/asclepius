import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import Root from "./Root";
import "./index.css";

// pdf.js worker init lives in lib/pdfWorker.ts, imported only by the PDF
// viewers — keeping pdfjs-dist out of the entry bundle.
//
// Providers live in Root.tsx; the admin ones (auth, patient, pipeline
// status) are mounted by App around the admin routes only, so the doctor
// share surface never calls admin endpoints.

// After a redeploy, a page loaded from the previous build asks for chunks
// that no longer exist. Reload once to pick up the new build instead of
// leaving a broken page; the flag stops a reload loop if the new build is
// also broken. The server answers 410 for missing assets so this burst
// does not count toward the public proxy's fail2ban threshold.
const PRELOAD_RELOAD_KEY = "asclepius:preload-reload";
window.addEventListener("vite:preloadError", (event) => {
  try {
    if (sessionStorage.getItem(PRELOAD_RELOAD_KEY)) return;
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, "1");
  } catch {
    return;
  }
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => {
  // A page that stayed loaded may reload again after a later deploy.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(PRELOAD_RELOAD_KEY);
    } catch {
      // ignore
    }
  }, 10_000);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);
