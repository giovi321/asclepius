import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows an inline spinner before the label. */
  loading?: boolean;
}

/**
 * Per-variant colour treatment:
 *  - primary:   bg-primary + primary-foreground, darken via --primary-hover
 *  - secondary: bordered, accent background on hover
 *  - danger:    bg-destructive + destructive-foreground
 *  - ghost:     no border, accent background on hover (icon/close buttons)
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-hover",
  secondary: "border hover:bg-accent active:bg-accent",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/90",
  ghost: "hover:bg-accent active:bg-accent",
};

/**
 * Fixed heights per size; every size grows to the 44px touch minimum on
 * coarse pointers without changing desktop density.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-9 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors duration-fast " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:opacity-50 disabled:pointer-events-none coarse:min-h-11";

/**
 * Shared button primitive. The variant supplies the colour treatment and
 * the size supplies the height/padding; pass extra Tailwind via `className`
 * for the occasional one-off (`w-full`, `whitespace-nowrap`, ...). All
 * native button props (onClick, disabled, type, title, ...) pass through.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "sm",
      loading = false,
      className,
      type,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || loading}
        className={cn(
          BASE,
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export default Button;
