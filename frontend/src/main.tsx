import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./contexts/AuthContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { PatientProvider } from "./contexts/PatientContext";
import { ToastProvider } from "./contexts/ToastContext";
import { ConfirmProvider } from "./contexts/ConfirmContext";
import { PipelineStatusProvider } from "./contexts/PipelineStatusContext";
import "./index.css";

// Initialise pdf.js worker once at app startup (before any component mounts).
// pdfjs-dist is installed as react-pdf's peer dependency — versions always match.
import { pdfjs } from "react-pdf";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <PatientProvider>
            <ToastProvider>
              <ConfirmProvider>
                <PipelineStatusProvider>
                  <App />
                </PipelineStatusProvider>
              </ConfirmProvider>
            </ToastProvider>
          </PatientProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
