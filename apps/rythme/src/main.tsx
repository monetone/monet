import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@monet-ui/monet-core/index.css";
import "./rythme.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { initMonetFormat } from "@monet-ui/monet-format";
import { App } from "./App";

async function boot() {
  await initMonetFormat();
  createRoot(document.getElementById("root")!).render(
    <MonetProvider>
      <App />
    </MonetProvider>,
  );
  // Start the local MCP server bridge — native desktop only (it talks to the
  // Rust host over Tauri events). Dynamically imported so it's tree-shaken from
  // the browser bundle. The store it drives is registered by EditorProvider.
  if (isTauri()) {
    void import("./mcp").then((m) => m.startRythmeMcp()).catch((e) => console.error("MCP bridge failed:", e));
  }
}

void boot();
