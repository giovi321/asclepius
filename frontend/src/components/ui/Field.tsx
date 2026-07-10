import { cloneElement, isValidElement, useId } from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: React.ReactNode;
  /** Helper text below the control. */
  description?: React.ReactNode;
  /** Error message; when set the control gets aria-invalid and the message
   *  replaces the description. */
  error?: React.ReactNode;
  required?: boolean;
  className?: string;
  /** A single form control (Input/Textarea/Select or a native element).
   *  Field wires id, aria-describedby, and aria-invalid onto it. */
  children: React.ReactNode;
}

/**
 * Label + control + description/error wiring. Keeps every form in the app
 * on the same accessible markup without per-page useId boilerplate.
 */
export default function Field({
  label,
  description,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const descriptionId = `${id}-desc`;
  const hasHint = Boolean(error ?? description);

  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        "aria-describedby": hasHint ? descriptionId : undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </label>
      {control}
      {hasHint && (
        <p
          id={descriptionId}
          className={cn(
            "text-xs",
            error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {error ?? description}
        </p>
      )}
    </div>
  );
}
