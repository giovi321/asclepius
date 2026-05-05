import type { ConfirmOptions } from "../contexts/ConfirmContext";

export const BULK_CONFIRM_THRESHOLD = 10;

export interface BulkConfirmOpts {
  count: number;
  verb: string;
  noun: string;
  description: string;
  confirmText?: string;
  variant?: "default" | "destructive";
  targetLabel?: string;
}

export function shouldConfirmBulk(count: number): boolean {
  return count > BULK_CONFIRM_THRESHOLD;
}

export function buildBulkConfirm(opts: BulkConfirmOpts): ConfirmOptions {
  const { count, verb, noun, description, confirmText, variant, targetLabel } =
    opts;
  const plural = count === 1 ? noun : `${noun}s`;
  const suffix = targetLabel ? ` into "${targetLabel}"` : "";
  return {
    title: `${verb} ${count} ${plural}${suffix}?`,
    description,
    confirmText,
    variant,
  };
}
