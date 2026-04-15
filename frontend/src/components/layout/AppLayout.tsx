import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePatient } from "@/contexts/PatientContext";
import { useTheme } from "@/hooks/useTheme";
import PatientSelector from "@/components/PatientSelector";
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
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/files", label: "Files", icon: FolderTree },
];

export default function AppLayout() {
  const { user, logout } = useAuth();
  const { selectedPatient } = usePatient();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { theme, toggleTheme } = useTheme();

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
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <img src="/logo.svg" alt="Asclepius" className="h-7 w-7 rounded" />
          {sidebarOpen && (
            <span className="text-lg font-semibold">Asclepius</span>
          )}
        </div>

        {/* Patient selector */}
        {sidebarOpen && (
          <div className="border-b p-3">
            <PatientSelector />
          </div>
        )}

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

        {/* User info */}
        <div className="border-t p-3">
          <div className="flex items-center justify-between">
            {sidebarOpen && (
              <span className="text-sm text-muted-foreground truncate">
                {user?.display_name || user?.username}
              </span>
            )}
            <button
              onClick={logout}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {sidebarOpen && (
            <div className="mt-2 text-center">
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
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center gap-4 border-b px-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
          >
            <Menu className="h-5 w-5" />
          </button>
          <button
            onClick={toggleTheme}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
          {selectedPatient && (
            <div className="flex items-center gap-2 rounded-md bg-primary/10 px-3 py-1">
              <span className="text-sm font-medium text-primary">
                {selectedPatient.display_name}
              </span>
            </div>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
