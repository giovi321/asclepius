import { cn } from "@/lib/utils";

export type BadgeVariant =
  | "neutral"
  | "success"
  | "warning"
  | "info"
  | "destructive"
  | "violet"
  | "teal";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: "sm" | "md";
}

/** Ink-on-soft-tint pairs from the semantic tokens (see DESIGN.md). */
const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  info: "bg-info-soft text-info border-info/25",
  destructive: "bg-destructive-soft text-destructive border-destructive/25",
  violet: "bg-cat-violet-soft text-cat-violet border-cat-violet/25",
  teal: "bg-cat-teal-soft text-cat-teal border-cat-teal/25",
};

const SIZE_CLASSES = {
  sm: "px-1.5 py-0.5 text-[11px]",
  md: "px-2 py-0.5 text-xs",
};

export default function Badge({
  variant = "neutral",
  size = "md",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
}
