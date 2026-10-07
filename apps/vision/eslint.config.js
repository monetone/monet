import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Flat config. The point of having ESLint at all is to make the existing
// `eslint-disable react-hooks/exhaustive-deps` / `no-new-func` directives
// enforceable. tsc already owns
// unused-vars / no-explicit-any strictness, so those are left to the compiler
// to avoid double-reporting.
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "engine/pkg/",
      "src-tauri/",
      "public/",
      "test-assets/",
      "coverage/",
      "test-results/",
      "playwright-report/",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "e2e/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Ban `new Function`/eval; the scripting-console worker and the e2e specs
      // that ship a function across page.evaluate opt in via an inline disable.
      "no-new-func": "error",
      // tsc (strict + noUnusedLocals) already enforces these; don't double-report.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // The codebase uses `cond && fn()` / `a ? f() : g()` as statements idiomatically.
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],
      // Noisy on loop-carried flags (false positive in text/raster.ts).
      "no-useless-assignment": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["*.config.{ts,js}"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["src/mcp/mcp.generated.ts"],
    linterOptions: { reportUnusedDisableDirectives: "off" },
  },
  {
    files: ["scripts/**"],
    languageOptions: { globals: { ...globals.node } },
  },
);
