/**
 * Compatibility shim: the theme now lives in a context so multiple consumers
 * (top bar, nav drawer, share surface) stay in sync. Import path preserved
 * for existing call sites.
 */
export { useTheme } from "@/contexts/ThemeContext";
