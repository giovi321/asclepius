import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Styled native select — the OS picker is the right control on mobile
 * (wheel on iOS, sheet on Android), so we keep the native element and only
 * normalize sizing, border, and focus treatment.
 */
const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm",
        "transition-colors duration-fast",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive coarse:h-11",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";

export default Select;
