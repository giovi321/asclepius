import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Per-variant colour treatment, copied verbatim from the hand-rolled
 * buttons scattered across the app:
 *  - primary:   bg-primary + primary-foreground, darken on hover
 *  - secondary: bordered, accent background on hover
 *  - danger:    bg-destructive + destructive-foreground, darken on hover
 *  - ghost:     no border, accent background on hover (icon/close buttons)
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border hover:bg-accent",
  danger:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  ghost: "hover:bg-accent",
};

/**
 * Size scale matching the two padding/text combinations used by the
 * vast majority of duplicated buttons.
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none";

/**
 * Shared button primitive. The variant supplies the colour treatment and
 * the size supplies the padding; pass extra Tailwind via `className` for
 * the occasional one-off (`w-full`, `whitespace-nowrap`, ...). All native
 * button props (onClick, disabled, type, title, ...) pass through.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "sm", className, type, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          BASE,
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export default Button;
