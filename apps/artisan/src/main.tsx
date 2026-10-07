import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@monet-ui/monet-core/index.css";
import "./artisan.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { App } from "./App";
import { ErrorBoundary } from "./ui/error-boundary";
import { installUnsavedWorkGuard, store } from "./state/app";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Monet Artisan: #root element not found");
createRoot(rootEl).render(
  <MonetProvider>
    <ErrorBoundary>
      <App store={store} />
    </ErrorBoundary>
  </MonetProvider>,
);

void installUnsavedWorkGuard();

// Start the local MCP server bridge — native desktop only (it talks to the Rust
// host over Tauri events). Dynamically imported so it's tree-shaken from the
// browser bundle, and bound to the same `store` the UI renders.
if (isTauri()) {
  void import("./mcp").then((m) => m.startArtisanMcp()).catch((e) => console.error("MCP bridge failed:", e));
}
