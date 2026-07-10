import { lazy, Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
// Eager: first paint for the two entry surfaces (login form, share idle
// placeholder). Everything else is route-split — AppLayout renders lazy
// pages behind its own Suspense skeleton so the shell never flashes.
import LoginPage from "@/pages/LoginPage";
import ShareModeIdle from "@/pages/share/ShareModeIdle";
import { ShareSessionProvider } from "@/contexts/ShareSessionContext";

const SetupWizardPage = lazy(() => import("@/pages/SetupWizardPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const DocumentsPage = lazy(() => import("@/pages/DocumentsPage"));
const DocumentDetailPage = lazy(() => import("@/pages/DocumentDetailPage"));
const UnclassifiedPage = lazy(() => import("@/pages/UnclassifiedPage"));
const LabResultsPage = lazy(() => import("@/pages/LabResultsPage"));
const ImagingPage = lazy(() => import("@/pages/ImagingPage"));
const ImagingDetailPage = lazy(() => import("@/pages/ImagingDetailPage"));
const ChatPage = lazy(() => import("@/pages/ChatPage"));
const SearchPage = lazy(() => import("@/pages/SearchPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const PatientsPage = lazy(() => import("@/pages/PatientsPage"));
const TimelinePage = lazy(() => import("@/pages/TimelinePage"));
const EventsPage = lazy(() => import("@/pages/EventsPage"));
const FileBrowserPage = lazy(() => import("@/pages/FileBrowserPage"));
const SharesPage = lazy(() => import("@/pages/SharesPage"));
const ShareLandingPage = lazy(() => import("@/pages/share/ShareLandingPage"));
const ShareVerifyPage = lazy(() => import("@/pages/share/ShareVerifyPage"));
const ShareWaitingPage = lazy(() => import("@/pages/share/ShareWaitingPage"));
const ShareDashboardPage = lazy(
  () => import("@/pages/share/ShareDashboardPage"),
);
const ShareDocumentPage = lazy(() => import("@/pages/share/ShareDocumentPage"));

type AppMode = "core" | "share";

/**
 * Detect whether the backend is running in ``core`` or ``share`` mode.
 *
 * The share container serves the same SPA bundle as core, so we can't
 * tell at build time which surface a visitor is hitting. ``/health``
 * is mounted in both modes and reports its mode in the JSON body, so
 * we read it once on mount. Until the response arrives we render the
 * ShareModeIdle placeholder — dark page with a logo — so a visitor
 * landing on ``med.example.com`` never flashes a login form, even for
 * a frame.
 */
function useAppMode(): AppMode | null {
  const [mode, setMode] = useState<AppMode | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/health", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setMode(j?.mode === "share" ? "share" : "core");
      })
      .catch(() => {
        if (!cancelled) setMode("core");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return mode;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, needsSetup } = useAuth();
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (needsSetup) return <Navigate to="/setup" />;
  if (!user) return <Navigate to="/login" />;
  return <>{children}</>;
}

/**
 * Gate the first-run wizard: once any user exists the wizard must be
 * completely inaccessible (mirroring ownCloud's behaviour). Redirect
 * authenticated users home and unauthenticated users to login so the
 * route can never reveal the install form a second time.
 */
function SetupRoute() {
  const { user, loading, needsSetup } = useAuth();
  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }
  if (!needsSetup) return <Navigate to={user ? "/" : "/login"} replace />;
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <SetupWizardPage />
    </Suspense>
  );
}

/** Wrap a page element in its own ErrorBoundary so one crash doesn't blank the shell. */
const page = (label: string, el: React.ReactNode) => (
  <ErrorBoundary label={label}>{el}</ErrorBoundary>
);

export default function App() {
  const mode = useAppMode();

  // Until /health resolves, show the dark idle placeholder. This makes
  // a visitor on the public share host (``med.example.com``) see the
  // logo immediately rather than a brief flash of the login form.
  if (mode === null) return <ShareModeIdle />;

  if (mode === "share") {
    return (
      <Routes>
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
        <Route path="*" element={<ShareModeIdle />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupRoute />} />
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
            <Suspense fallback={<ShareModeIdle />}>
              <Outlet />
            </Suspense>
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
