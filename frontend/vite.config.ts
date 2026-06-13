/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    // jsdom gives us a DOM so React components can render in tests; globals
    // exposes describe/it/expect without per-file imports; setupFiles wires
    // in jest-dom matchers + auto-cleanup.
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
