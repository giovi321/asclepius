import { useEffect, useState } from "react";

/**
 * Debounce a value — the returned value only updates after `delay` ms of
 * inactivity. Extracted from PdfViewer: rapid scale changes must never
 * flood react-pdf with concurrent render requests (they crash the pdf.js
 * worker), and the DICOM viewer reuses the same idea for server-rendered
 * frame parameters (zoom bucket, window center/width).
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
