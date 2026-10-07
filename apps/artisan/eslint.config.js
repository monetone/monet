// Flat ESLint config — lints the first-party app source (src/). The Rust shell,
// build output, e2e harness scripts, and config files are out of scope.
// TypeScript's compiler is the primary correctness gate (`pnpm typecheck`);
// this layer catches React-hooks mistakes and dead code.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "scripts/**", "engine/**", "**/*.config.{js,ts}"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // TypeScript already resolves identifiers; core no-undef double-flags DOM/Node globals.
      "no-undef": "off",
      // Edge-case-prone dead-store rule that trips on accumulator/branch-assign patterns
      // used throughout the geometry/parser code; TS + review cover real dead code.
      "no-useless-assignment": "off",
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipComments: true, skipJSXText: true }],
      "prefer-const": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // tsconfig leaves noUnusedLocals/Parameters off by design; surface as warnings, not errors.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The shortcut/command dispatch uses `cond && command()` / ternaries as statements.
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
    },
  },
);
