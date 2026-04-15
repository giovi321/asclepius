import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { DocumentStatus } from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Document helpers (used across 5+ pages) ──────────

/**
 * Return the best available date from a document object.
 * Priority: date_visit > date_issued > doc_date.
 */
export function getBestDate(doc: {
  date_visit?: string | null;
  date_issued?: string | null;
  doc_date?: string | null;
}): string {
  return doc.date_visit || doc.date_issued || doc.doc_date || "";
}

/**
 * Format a YYYY-MM-DD date string for display.
 * Returns "No date" for falsy input.
 */
export function formatDate(s: string | null | undefined): string {
  if (!s) return "No date";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Format doc_type for display: replace underscores with spaces.
 */
export function formatDocType(type: string | null | undefined): string {
  if (!type) return "Unknown type";
  return type.replace(/_/g, " ");
}

// ─── Status badge styling ──────────────────────────────

const STATUS_CLASSES: Record<string, string> = {
  done: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  pending: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  needs_review: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  cancelled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

/**
 * Return Tailwind classes for a document status badge.
 */
export function getStatusClasses(status: DocumentStatus | string): string {
  return STATUS_CLASSES[status] || STATUS_CLASSES.pending;
}
