import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * Styled native input. `text-base sm:text-sm` keeps a 16px floor on small
 * screens so iOS Safari doesn't auto-zoom on focus; `border-input` uses the
 * darker form-control border token (3:1 non-text contrast).
 */
export const INPUT_CLASSES =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm " +
  "placeholder:text-muted-foreground transition-colors duration-fast " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive coarse:h-11";

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(INPUT_CLASSES, className)} {...props} />
  ),
);
Input.displayName = "Input";

export default Input;
