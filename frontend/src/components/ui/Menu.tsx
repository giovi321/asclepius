import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Action menu on Radix DropdownMenu. For PURE action lists only (row
 * overflow "...", rotate menu); anything containing form controls belongs
 * in a Popover or Sheet instead.
 */
export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export const MenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenu.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenu.Portal>
    <DropdownMenu.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={8}
      className={cn(
        "z-dropdown min-w-[10rem] overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-overlay",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-fast",
        className,
      )}
      {...props}
    />
  </DropdownMenu.Portal>
));
MenuContent.displayName = "MenuContent";

export const MenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenu.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.Item> & {
    destructive?: boolean;
  }
>(({ className, destructive = false, ...props }, ref) => (
  <DropdownMenu.Item
    ref={ref}
    className={cn(
      "flex min-h-9 cursor-default select-none items-center gap-2 rounded-sm px-3 text-sm outline-none coarse:min-h-11",
      "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      destructive &&
        "text-destructive data-[highlighted]:bg-destructive-soft data-[highlighted]:text-destructive",
      className,
    )}
    {...props}
  />
));
MenuItem.displayName = "MenuItem";

export const MenuCheckboxItem = forwardRef<
  React.ComponentRef<typeof DropdownMenu.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenu.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenu.CheckboxItem
    ref={ref}
    className={cn(
      "flex min-h-9 cursor-default select-none items-center gap-2 rounded-sm px-3 pl-8 text-sm outline-none coarse:min-h-11",
      "data-[highlighted]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenu.ItemIndicator>
        <Check className="h-3.5 w-3.5 text-primary" />
      </DropdownMenu.ItemIndicator>
    </span>
    {children}
  </DropdownMenu.CheckboxItem>
));
MenuCheckboxItem.displayName = "MenuCheckboxItem";

export function MenuSeparator({ className }: { className?: string }) {
  return (
    <DropdownMenu.Separator className={cn("my-1 h-px bg-border", className)} />
  );
}

export function MenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn(
        "px-3 py-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
