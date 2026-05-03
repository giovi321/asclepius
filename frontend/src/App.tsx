import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoginPage from "@/pages/LoginPage";
import SetupWizardPage from "@/pages/SetupWizardPage";
import DashboardPage from "@/pages/DashboardPage";
import DocumentsPage from "@/pages/DocumentsPage";
import DocumentDetailPage from "@/pages/DocumentDetailPage";
import UnclassifiedPage from "@/pages/UnclassifiedPage";
import LabResultsPage from "@/pages/LabResultsPage";
import ImagingPage from "@/pages/ImagingPage";
import ImagingDetailPage from "@/pages/ImagingDetailPage";
import ChatPage from "@/pages/ChatPage";
import SearchPage from "@/pages/SearchPage";
import SettingsPage from "@/pages/SettingsPage";
import PatientsPage from "@/pages/PatientsPage";
import TimelinePage from "@/pages/TimelinePage";
import EventsPage from "@/pages/EventsPage";
import FileBrowserPage from "@/pages/FileBrowserPage";
import SharesPage from "@/pages/SharesPage";
import ShareLandingPage from "@/pages/share/ShareLandingPage";
import ShareVerifyPage from "@/pages/share/ShareVerifyPage";
import ShareWaitingPage from "@/pages/share/ShareWaitingPage";
import ShareDashboardPage from "@/pages/share/ShareDashboardPage";
import ShareDocumentPage from "@/pages/share/ShareDocumentPage";
import { ShareSessionProvider } from "@/contexts/ShareSessionContext";

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

/** Wrap a page element in its own ErrorBoundary so one crash doesn't blank the shell. */
const page = (label: string, el: React.ReactNode) => (
  <ErrorBoundary label={label}>{el}</ErrorBoundary>
);

export default function App() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupWizardPage />} />
      <Route path="/login" element={<LoginPage />} />
      {/* Doctor share surface — lives outside ProtectedRoute and outside
          the regular AuthContext-bound AppLayout so account auth and
          share auth are entirely isolated. We use the Outlet pattern
          (not a nested <Routes>) so useParams() correctly picks up
          ``:token`` in the leaf components. */}
      <Route
        path="/share"
        element={
          <ShareSessionProvider>
            <Outlet />
          </ShareSessionProvider>
        }
      >
        <Route index element={<ShareLandingPage />} />
        <Route
          path="dashboard"
          element={page("Share dashboard", <ShareDashboardPage />)}
        />
        <Route
          path="documents/:id"
          element={page("Share document", <ShareDocumentPage />)}
        />
        <Route
          path="waiting"
          element={page("Share waiting", <ShareWaitingPage />)}
        />
        <Route path=":token/verify" element={<ShareVerifyPage />} />
        <Route path=":token" element={<ShareLandingPage />} />
      </Route>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={page("Dashboard", <DashboardPage />)} />
        <Route path="patients" element={page("Patients", <PatientsPage />)} />
        <Route
          path="documents"
          element={page("Documents", <DocumentsPage />)}
        />
        <Route path="timeline" element={page("Timeline", <TimelinePage />)} />
        <Route path="events" element={page("Events", <EventsPage />)} />
        <Route
          path="documents/:id"
          element={page("Document Detail", <DocumentDetailPage />)}
        />
        <Route
          path="unclassified"
          element={page("Unclassified", <UnclassifiedPage />)}
        />
        <Route
          path="lab-results"
          element={page("Lab Results", <LabResultsPage />)}
        />
        <Route path="imaging" element={page("Imaging", <ImagingPage />)} />
        <Route
          path="imaging/:studyId"
          element={page("Imaging Detail", <ImagingDetailPage />)}
        />
        <Route path="chat" element={page("Chat", <ChatPage />)} />
        <Route path="search" element={page("Search", <SearchPage />)} />
        <Route path="shares" element={page("Doctor Shares", <SharesPage />)} />
        <Route path="settings/*" element={page("Settings", <SettingsPage />)} />
        <Route path="files" element={page("Files", <FileBrowserPage />)} />
      </Route>
    </Routes>
  );
}
