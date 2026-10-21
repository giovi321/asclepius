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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </React.StrictMode>,
);
