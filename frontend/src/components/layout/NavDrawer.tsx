import { Link, useLocation } from "react-router-dom";
import { LogOut, Moon, Sun } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import Sheet from "@/components/ui/Sheet";
import IconButton from "@/components/ui/IconButton";
import {
  isNavItemActive,
  NAV_ITEMS,
  SECONDARY_NAV_ITEMS,
} from "@/components/layout/nav";
import packageJson from "../../../package.json";

export interface NavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Mobile navigation drawer: a left-edge Sheet over a backdrop. AppLayout
 * closes it on every route change. Rows are 44px; Settings and Files are
 * full rows here (not icon-only) — on a phone they are primary
 * destinations, not corner furniture.
 */
export default function NavDrawer({ open, onOpenChange }: NavDrawerProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const navLink = (item: (typeof NAV_ITEMS)[number]) => {
    const Icon = item.icon;
    const isActive = isNavItemActive(item.path, location.pathname);
    return (
      <Link
        key={item.path}
        to={item.path}
        className={cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
          isActive
            ? "bg-primary/10 font-medium text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4 flex-shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Navigation"
      hideTitle
      hideCloseButton
      side="left"
      contentClassName="z-drawer bg-surface text-surface-foreground"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 pb-2 pt-1">
          <img
            src="/logo.svg"
            alt="Asclepius"
            className="h-10 w-10 flex-shrink-0 rounded-lg"
          />
          <span className="text-lg font-semibold">Asclepius</span>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto py-1">
          {NAV_ITEMS.map(navLink)}
          <div className="my-2 border-t" />
          {SECONDARY_NAV_ITEMS.map(navLink)}
        </nav>

        <div className="flex items-center justify-between border-t pt-2 pb-safe">
          <a
            href="https://github.com/giovi321/asclepius"
            target="_blank"
            rel="noreferrer"
            className="text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            Asclepius v{packageJson.version}
          </a>
          <div className="flex items-center gap-1">
            <IconButton
              label={
                theme === "dark"
                  ? "Switch to light mode"
                  : "Switch to dark mode"
              }
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
              onClick={logout}
            >
              <LogOut className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
