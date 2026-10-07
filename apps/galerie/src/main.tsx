import { isTauri } from "@tauri-apps/api/core";
import { MonetProvider } from "@monet-ui/monet-react";
import { createRoot } from "react-dom/client";
import "@monet-ui/monet-core/index.css";
import "./galerie.css";
import { App } from "./App";
import { SecondaryDisplay } from "./ui/SecondaryDisplay";

const el = document.getElementById("root");
if (!el) throw new Error("Monet Galerie: #root not found");
createRoot(el).render(
  <MonetProvider>
    {new URLSearchParams(location.search).has("secondary") ? <SecondaryDisplay /> : <App />}
  </MonetProvider>,
);

// Start the local MCP server bridge — native desktop only (it talks to the Rust
// host over Tauri events). Dynamically imported so it's tree-shaken from the
// browser bundle.
if (isTauri()) {
  void import("./mcp").then((m) => m.startGalerieMcp()).catch((e) => console.error("MCP bridge failed:", e));
}
