// Flat ESLint config — lints the first-party app source (src/). The Rust shell,
// engine, build output, and config files are out of scope. TypeScript's compiler
// is the primary correctness gate (`pnpm typecheck`); this layer catches
// React-hooks mistakes and dead code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "engine/pkg/",
      "src-tauri/",
      "public/",
      "coverage/",
      "test-results/",
      "playwright-report/",
      // e2e specs + fixture tooling are intentionally loose (they drive the
      // DEV-only `window.__mc` hook via `any`); tsc on src/ is the real gate.
      "e2e/",
      "scripts/",
      "**/*.config.{js,ts}",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // tsc (strict + noUnusedLocals) already enforces these; don't double-report.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // The codebase uses `cond && fn()` / `a ? f() : g()` as statements idiomatically.
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],
      "no-useless-assignment": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
