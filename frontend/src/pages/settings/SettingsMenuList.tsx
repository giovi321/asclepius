import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

export interface SettingsMenuEntry {
  key: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Mobile list-first settings menu. Rendered at bare /settings below lg:
 * one tappable row per visible settings section; tapping drills into
 * /settings/<key>, which renders that pane full-width with a back row.
 */
export default function SettingsMenuList({
  entries,
}: {
  entries: readonly SettingsMenuEntry[];
}) {
  const navigate = useNavigate();
  return (
    <nav
      aria-label="Settings sections"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <ul className="divide-y">
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <li key={entry.key}>
              <button
                type="button"
                onClick={() => navigate(`/settings/${entry.key}`)}
                className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors duration-fast hover:bg-accent active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-medium">
                  {entry.label}
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
