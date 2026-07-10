import {
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import Sheet from "@/components/ui/Sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/Popover";

export interface PickerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The anchor control. Cloned with onClick on mobile; wrapped in a
   *  PopoverTrigger on desktop. Must accept a click handler. */
  trigger: ReactElement;
  /** Sheet title on mobile (screen-reader context everywhere). */
  title: string;
  searchable?: boolean;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  /** Pinned row(s) between search and the list (actions bar, etc). */
  header?: ReactNode;
  /** The option list. Rows should use PickerOption for consistent sizing. */
  children: ReactNode;
  /** Desktop popover panel classes. */
  panelClassName?: string;
}

/**
 * Presentation shell for search-and-pick controls: a bottom Sheet below sm,
 * an anchored Popover from sm up. Search/option semantics belong to the
 * consumer (Combobox, MultiSelect, PatientSelector); this component owns
 * only where the panel appears and the shared search-box markup.
 */
export default function PickerShell({
  open,
  onOpenChange,
  trigger,
  title,
  searchable = true,
  search = "",
  onSearchChange,
  searchPlaceholder = "Search...",
  header,
  children,
  panelClassName,
}: PickerShellProps) {
  const isPhone = !useMediaQuery("(min-width: 640px)");
  const searchRef = useRef<HTMLInputElement>(null);

  // Desktop: focus search on open. Mobile: leave the keyboard down until
  // the user taps the field (it would cover half the option list).
  useEffect(() => {
    if (open && !isPhone) searchRef.current?.focus();
  }, [open, isPhone]);

  const searchBox = searchable && onSearchChange && (
    <div className={cn("border-b p-2", isPhone && "px-0")}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-base sm:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:h-11"
        />
      </div>
    </div>
  );

  if (isPhone) {
    return (
      <>
        {isValidElement(trigger)
          ? cloneElement(trigger as ReactElement<Record<string, unknown>>, {
              onClick: () => onOpenChange(!open),
              "aria-expanded": open,
            })
          : trigger}
        <Sheet open={open} onOpenChange={onOpenChange} title={title}>
          {searchBox}
          {header}
          <div className="-mx-1 py-1">{children}</div>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className={cn("w-80 max-w-[360px]", panelClassName)}>
        {searchBox}
        {header}
        <div className="max-h-[280px] overflow-y-auto py-1">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/** Standard option row: full-width, 36px (44px coarse), truncating label. */
export function PickerOption({
  selected = false,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-9 w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors coarse:min-h-11",
        "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
        selected && "bg-accent/60 font-medium",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
