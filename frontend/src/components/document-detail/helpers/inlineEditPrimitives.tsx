import React from "react";

// ─── Inline edit action buttons ────────────────────────────────
// Fixed-height (h-7) inline action buttons. The shared height +
// flex centering means a text label and a 12px icon end up the same
// visual height — fixes the mismatch where "Save" looked taller than
// the X close button despite identical padding.

type ActionVariant = "primary" | "outline" | "danger";
const ACTION_VARIANTS: Record<ActionVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border bg-background hover:bg-accent",
  danger:
    "border border-destructive/40 text-destructive hover:bg-destructive/10",
};

export const ActionButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ActionVariant }
>(function ActionButton(
  { variant = "outline", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`h-7 inline-flex items-center justify-center rounded border-transparent px-2.5 text-xs font-medium disabled:opacity-50 coarse:min-h-11 coarse:px-3 ${ACTION_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
});

export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ label, className = "", children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={`h-7 w-7 inline-flex items-center justify-center rounded border bg-background hover:bg-accent disabled:opacity-50 coarse:h-11 coarse:w-11 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

// ─── InfoRow (read-only) ───────────────────────────────────────

export function InfoRow({ label, value }: { label: string; value: any }) {
  if (!value) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
