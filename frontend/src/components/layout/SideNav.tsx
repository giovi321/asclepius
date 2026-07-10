import { Link, useLocation } from "react-router-dom";
import { LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import PatientSelector from "@/components/PatientSelector";
import IconButton from "@/components/ui/IconButton";
import {
  isNavItemActive,
  NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from "@/components/layout/nav";
import packageJson from "../../../package.json";

export interface SideNavProps {
  /** Rail mode: 64px icon strip instead of the full 256px column. */
  collapsed: boolean;
  className?: string;
}

/**
 * Desktop sidebar (lg and up). Mobile navigation is the overlay NavDrawer —
 * this component never renders below lg. Sits on the `surface` neutral
 * layer to separate chrome from content.
 */
export default function SideNav({ collapsed, className }: SideNavProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  return (
    <aside
      className={cn(
        "flex-col border-r bg-surface text-surface-foreground transition-[width] duration-base ease-out",
        collapsed ? "w-16" : "w-64",
        className,
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-3 py-3">
        <img
          src="/logo.svg"
          alt="Asclepius"
          className="h-10 w-10 flex-shrink-0 rounded-lg"
        />
        {!collapsed && <span className="text-lg font-semibold">Asclepius</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = isNavItemActive(item.path, location.pathname);
          return (
            <Link
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                isActive
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Footer: patient + icon row + version link */}
      <div className="space-y-2 p-3">
        {!collapsed && <PatientSelector variant="block" />}

        <div>
          <div
            className={cn(
              "flex items-center gap-1",
              collapsed ? "flex-col" : "justify-between",
            )}
          >
            {SECONDARY_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  title={item.label}
                  aria-label={item.label}
                  className={cn(
                    "rounded-md p-2 transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
            <IconButton
              label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
              size="sm"
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </IconButton>
            <IconButton
              label={`Logout (${user?.display_name || user?.username || ""})`}
              size="sm"
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
            </IconButton>
          </div>

          {!collapsed && (
            <div className="text-center leading-none">
              <a
                href="https://github.com/giovi321/asclepius"
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              >
                Asclepius v{packageJson.version}
              </a>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
