import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import LoginPage from "@/pages/LoginPage";
import SetupWizardPage from "@/pages/SetupWizardPage";
import DashboardPage from "@/pages/DashboardPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DocumentDetailPage from "@/pages/DocumentDetailPage";
import UnclassifiedPage from "@/pages/UnclassifiedPage";
import LabResultsPage from "@/pages/LabResultsPage";
import ImagingPage from "@/pages/ImagingPage";
import ChatPage from "@/pages/ChatPage";
import SearchPage from "@/pages/SearchPage";
import SettingsPage from "@/pages/SettingsPage";
import PatientsPage from "@/pages/PatientsPage";
import TimelinePage from "@/pages/TimelinePage";
import EventsPage from "@/pages/EventsPage";
import FileBrowserPage from "@/pages/FileBrowserPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (needsSetup) return <Navigate to="/setup" />;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="documents" element={<DocumentsPage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="documents/:id" element={<DocumentDetailPage />} />
        <Route path="unclassified" element={<UnclassifiedPage />} />
        <Route path="lab-results" element={<LabResultsPage />} />
        <Route path="imaging" element={<ImagingPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="files" element={<FileBrowserPage />} />
      </Route>
    </Routes>
  );
}
