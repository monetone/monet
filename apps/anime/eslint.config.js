import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Flat config, matching the other Monet apps so every app lints alike. ESLint's
// job here is the react-hooks rules and the eval/no-new-func ban. Anime's
// tsconfig leaves noUnusedLocals/Parameters off by design, so — unlike Vision —
// unused-vars is surfaced here as a warning rather than left to the compiler.
export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "src-tauri/",
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
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
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
);
