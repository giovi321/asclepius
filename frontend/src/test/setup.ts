// Vitest global setup: extends `expect` with @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveAttribute, ...) and auto-cleans the
// rendered DOM between tests. Wired in via the `test.setupFiles` entry in
// vite.config.ts.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
