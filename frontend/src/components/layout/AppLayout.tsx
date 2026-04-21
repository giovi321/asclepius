import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import PatientSelector from "@/components/PatientSelector";
import MetricsStrip from "@/components/layout/MetricsStrip";
import packageJson from "../../../package.json";
import {
  LayoutDashboard,
  FileText,
  AlertCircle,
  TestTube,
  Image,
  MessageCircle,
  Search,
  Settings,
  LogOut,
  Menu,
  Users,
  Clock,
  Heart,
  Sun,
  Moon,
  FolderTree,
} from "lucide-react";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/patients", label: "Patients", icon: Users },
  { path: "/documents", label: "Documents", icon: FileText },
  { path: "/timeline", label: "Timeline", icon: Clock },
  { path: "/events", label: "Medical Events", icon: Heart },
  { path: "/unclassified", label: "Unclassified", icon: AlertCircle },
  { path: "/lab-results", label: "Lab Results", icon: TestTube },
  { path: "/imaging", label: "Imaging", icon: Image },
  { path: "/chat", label: "Chat", icon: MessageCircle },
  { path: "/search", label: "Search", icon: Search },
];

// Titles for every top-level route, including the ones that were moved
// out of the main nav but still exist as pages (Settings, Files).
const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/patients": "Patients",
  "/documents": "Documents",
  "/timeline": "Timeline",
  "/events": "Medical Events",
  "/unclassified": "Unclassified",
  "/lab-results": "Lab Results",
  "/imaging": "Imaging",
  "/chat": "Chat",
  "/search": "Search",
  "/settings": "Settings",
  "/files": "Files",
};

function pageTitleFor(pathname: string): string {
  if (pathname === "/") return PAGE_TITLES["/"];
  // Longest-prefix match so /settings/analysis/providers still reads
  // "Settings" rather than falling through.
  const sorted = Object.keys(PAGE_TITLES)
    .filter((p) => p !== "/")
    .sort((a, b) => b.length - a.length);
  const match = sorted.find((p) => pathname === p || pathname.startsWith(p + "/"));
  return match ? PAGE_TITLES[match] : "";
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { theme, toggleTheme } = useTheme();

  const settingsActive = location.pathname.startsWith("/settings");
  const filesActive = location.pathname.startsWith("/files");

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-64" : "w-0 -ml-64"
        } flex flex-col border-r bg-card transition-all duration-200 lg:ml-0 ${
          sidebarOpen ? "lg:w-64" : "lg:w-16"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-3">
          <img src="/logo.svg" alt="Asclepius" className="h-14 w-14 rounded-lg flex-shrink-0" />
          {sidebarOpen && (
            <span className="text-lg font-semibold">Asclepius</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {sidebarOpen && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer: patient + icon row + github */}
        <div className="p-3 space-y-2">
          {sidebarOpen && <PatientSelector />}

          {/* Icon row + version link pair — tight vertical gap. */}
          <div>
            <div className={`flex items-center gap-1 ${sidebarOpen ? "justify-between" : "flex-col"}`}>
              <Link
                to="/settings"
                title="Settings"
                aria-label="Settings"
                className={`rounded-md p-2 transition-colors ${
                  settingsActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Settings className="h-4 w-4" />
              </Link>
              <Link
                to="/files"
                title="Files"
                aria-label="Files"
                className={`rounded-md p-2 transition-colors ${
                  filesActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <FolderTree className="h-4 w-4" />
              </Link>
              <button
                onClick={toggleTheme}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
                aria-label="Toggle theme"
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                onClick={logout}
                title={`Logout (${user?.display_name || user?.username || ""})`}
                aria-label="Logout"
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            {sidebarOpen && (
              <div className="text-center leading-none">
                <a
                  href="https://github.com/giovi321/asclepius"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                >
                  Asclepius v{packageJson.version}
                </a>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-3 border-b px-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent flex-shrink-0"
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <Menu className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold truncate flex-shrink-0">
            {pageTitleFor(location.pathname)}
          </h1>
          <div className="flex-1 min-w-0 flex justify-end">
            <MetricsStrip />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
