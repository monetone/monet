import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@monet-ui/monet-core/index.css";
import "./styles.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { App } from "./App";
import { ErrorBoundary, BootError } from "./ui/error-boundary";
import { initEngine } from "./engine/EngineClient";
import { initMonetFormat } from "@monet-ui/monet-format";
import { store, engine } from "./state/app";
import { createProject } from "./timeline/model/factory";
import { installUnsavedWorkGuard } from "./state/unsaved-work-guard";

// Build-time flag (vite define): exposes `window.__mc` in a production bundle
// for e2e / scripted verification. False (and tree-shaken) in normal builds.
declare const __MC_EXPOSE__: boolean;

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    await initEngine();
    await initMonetFormat();
    store.replaceProject(createProject("Untitled"));
    store.setReady(true);
    // #506: veto window close / ⌘Q while the project is dirty.
    void installUnsavedWorkGuard(store);
    if (import.meta.env.DEV || __MC_EXPOSE__) {
      // Full app API for e2e / scripted verification (tree-shaken from a
      // normal production build; gated by DEV || __MC_EXPOSE__).
      const cmd = await import("./commands");
      const media = await import("./media/import");
      const registry = await import("./media/registry");
      const decoder = await import("./media/decoder");
      const playback = await import("./playback/compositor");
      const query = await import("./timeline/model/query");
      (window as unknown as { __mc: unknown }).__mc = { store, engine, cmd, media, registry, decoder, playback, query };
    }
    // Start the local MCP server bridge — native desktop only (it talks to the
    // Rust host over Tauri events). Dynamically imported so it's tree-shaken
    // from the browser bundle.
    if (isTauri()) {
      void import("./mcp").then((m) => m.startCinemaMcp()).catch((e) => console.error("MCP bridge failed:", e));
    }
    root.render(
      <MonetProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </MonetProvider>,
    );
  } catch (e) {
    console.error("Monet Cinema failed to start:", e);
    root.render(<BootError title="Monet Cinema couldn’t start" detail={e instanceof Error ? e.message : String(e)} />);
  }
}

void boot();
