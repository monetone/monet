import { defineConfig } from "vitest/config";

// Scope tests to Artisan's own pure-engine suite. Shared packages have their
// own tests.
export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
    server: { deps: { inline: ["@monet-ui/monet-react"] } },
  },
});
