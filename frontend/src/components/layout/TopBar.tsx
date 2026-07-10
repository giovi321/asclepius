import { Menu, PanelLeft } from "lucide-react";
import IconButton from "@/components/ui/IconButton";
import MetricsStrip, { PipelineChip } from "@/components/layout/MetricsStrip";
import PatientSelector from "@/components/PatientSelector";

export interface TopBarProps {
  title: string;
  /** Below lg: opens the NavDrawer. */
  onOpenDrawer: () => void;
  /** lg and up: toggles the SideNav rail. */
  onToggleSidebar: () => void;
}

/**
 * The app's top bar. One bar, responsive children:
 *  - below lg: hamburger (drawer), title, pipeline summary chip, patient chip
 *  - lg and up: sidebar-collapse toggle, title, full MetricsStrip
 * Safe-area padded so it clears notches in landscape.
 */
export default function TopBar({
  title,
  onOpenDrawer,
  onToggleSidebar,
}: TopBarProps) {
  return (
    <header className="flex min-h-14 items-center gap-2 border-b bg-surface px-2 pt-safe text-surface-foreground sm:px-4">
      <IconButton
        label="Open navigation"
        size="lg"
        className="lg:hidden"
        onClick={onOpenDrawer}
      >
        <Menu className="h-5 w-5" />
      </IconButton>
      <IconButton
        label="Toggle sidebar"
        size="md"
        className="hidden lg:inline-flex"
        onClick={onToggleSidebar}
      >
        <PanelLeft className="h-5 w-5" />
      </IconButton>

      <h1 className="min-w-0 flex-shrink truncate text-lg font-semibold">
        {title}
      </h1>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <div className="hidden min-w-0 md:flex">
          <MetricsStrip />
        </div>
        <div className="md:hidden">
          <PipelineChip />
        </div>
        <div className="lg:hidden">
          <PatientSelector variant="chip" />
        </div>
      </div>
    </header>
  );
}
