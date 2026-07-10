import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type IconButtonVariant = "ghost" | "secondary" | "danger";
export type IconButtonSize = "sm" | "md" | "lg";

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name; icon-only buttons are unusable to screen readers
   *  without one, so it is required. Also used as the hover title. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  ghost: "hover:bg-accent active:bg-accent text-muted-foreground hover:text-foreground",
  secondary: "border hover:bg-accent active:bg-accent",
  danger:
    "text-destructive hover:bg-destructive-soft active:bg-destructive-soft",
};

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: "h-8 w-8",
  md: "h-9 w-9",
  lg: "h-11 w-11",
};

/**
 * Square icon-only button. Same visual vocabulary as Button; grows to the
 * 44px touch minimum on coarse pointers.
 */
const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, variant = "ghost", size = "md", className, type, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:opacity-50 disabled:pointer-events-none coarse:h-11 coarse:w-11",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
IconButton.displayName = "IconButton";

export default IconButton;
