import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

/**
 * Flat ESLint config for the Asclepius frontend.
 *
 * This codebase had never been linted, so a strict config would surface
 * hundreds of pre-existing issues and block CI on day one. The intent here
 * is a *green baseline gate*: keep genuinely valuable rules as errors
 * (rules-of-hooks, no-debugger, valid disable-directives) while downgrading
 * the noisy stylistic/legacy rules to warnings so they are visible without
 * failing `npm run lint`. Tighten the warnings into errors over time.
 *
 * Type-aware linting is intentionally NOT enabled (recommended, not
 * recommendedTypeChecked) to keep linting fast and avoid a second
 * type-resolution pass on top of `tsc`.
 *
 * Note: react-hooks' `recommended-latest` preset is not spread here. Its
 * `plugins` key is a legacy string array (rejected by ESLint 10 flat
 * config) and it enables the aggressive React-Compiler rule set as errors,
 * which would break the baseline gate. We register the plugin manually and
 * opt into the two classic rules instead.
 */
export default tseslint.config(
  // Don't lint build output, deps, or generated API types.
  {
    ignores: ["dist", "node_modules", "src/api/schema.ts"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    linterOptions: {
      // Surface eslint-disable directives that no longer suppress anything.
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      // ── Kept as errors: high signal, low false-positive ──
      "react-hooks/rules-of-hooks": "error",
      "no-debugger": "error",

      // ── Downgraded to warn: pre-existing across the codebase ──
      // Stylistic / legacy noise that would otherwise block the gate.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "no-empty": "warn",
      "no-useless-escape": "warn",
      // Effect-dependency completeness is advisory; many deps are
      // intentionally omitted in this codebase.
      "react-hooks/exhaustive-deps": "warn",
      // Fast-refresh boundary hygiene — useful but not worth blocking on.
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
