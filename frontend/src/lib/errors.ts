import { AxiosError } from "axios";

type FastApiDetailItem = { msg?: string };

/**
 * Normalize any thrown value into a human-readable message.
 *
 * Handles the shapes the backend + axios produce:
 *  - AxiosError with a string `detail` (our HTTPException convention),
 *  - AxiosError with an array `detail` (FastAPI 422 validation errors) — these
 *    previously rendered as "[object Object]",
 *  - a plain Error (network failure, etc.),
 *  - anything else (falls back to the provided message).
 */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  const detail = (err as AxiosError<{ detail?: unknown }>)?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (typeof d === "string" ? d : (d as FastApiDetailItem)?.msg))
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    if (msgs.length) return msgs.join("; ");
  }
  if (detail && typeof detail === "object") {
    const msg = (detail as FastApiDetailItem).msg;
    if (typeof msg === "string" && msg) return msg;
  }
  const message = (err as { message?: unknown })?.message;
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}
