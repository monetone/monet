import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Flat config, cloned from apps/vision so the two photo apps lint alike. tsc
// (strict + noUnusedLocals) already owns unused-vars / no-explicit-any, so those
// stay off here to avoid double-reporting; ESLint's job is the hooks rules and
// the eval/no-new-func ban.
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "engine/pkg/",
      "src-tauri/",
      "public/",
      "proofs/",
      "coverage/",
      "test-results/",
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
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }],
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
