import { initMonetFormat } from "@monet-ui/monet-format";
import { MonetProvider } from "@monet-ui/monet-react";
import { isTauri } from "@tauri-apps/api/core";
import { createRoot } from "react-dom/client";
import "@monet-ui/monet-core/index.css";
import "./anime.css";
import { App } from "./App";
import { createProject } from "./model/factory";
import { store } from "./state/store";
import { installUnsavedWorkGuard } from "./state/unsaved-work-guard";

async function boot() {
  const el = document.getElementById("root");
  if (!el) throw new Error("Monet Anime: #root not found");
  const root = createRoot(el);
  try {
    // The .monet format logic is WASM-backed; initialize before any save/open.
    await initMonetFormat();
    store.replaceProject(createProject("Untitled"), { markClean: true });
    store.setReady(true);
    // #506: veto window close / ⌘Q while the project is dirty.
    void installUnsavedWorkGuard(store);
    root.render(
      <MonetProvider>
        <App />
      </MonetProvider>,
    );
    // Start the local MCP server bridge — native desktop only (it talks to the
    // Rust host over Tauri events). Dynamically imported so it's tree-shaken
    // from the browser bundle.
    if (isTauri()) {
      void import("./mcp").then((m) => m.startAnimeMcp()).catch((e) => console.error("MCP bridge failed:", e));
    }
  } catch (e) {
    console.error("Monet Anime failed to start:", e);
    root.render(<div style={{ padding: 24, color: "#ff8787", font: "13px system-ui" }}>Monet Anime failed to start: {String(e)}</div>);
  }
}

void boot();
