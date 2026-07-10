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

// pdf.js worker init lives in lib/pdfWorker.ts, imported only by the PDF
// viewers — keeping pdfjs-dist out of the entry bundle.

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
