import { formatDateTime } from "@/lib/datetime";

export function formatLocal(iso: string): string {
  return formatDateTime(iso);
}
