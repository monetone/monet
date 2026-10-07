import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@monet-ui/monet-core/index.css";
import "./styles.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { App } from "./App";
import { ErrorBoundary, BootError } from "./ui/error-boundary";
import { initMonetFormat } from "@monet-ui/monet-format";
import { store } from "./state/app";
import { createProject } from "./model/factory";
import { installUnsavedWorkGuard } from "./state/unsaved-work-guard";

// Build-time flag (vite define): exposes `window.__mj` in a production bundle
// for e2e / scripted verification. False (and tree-shaken) in normal builds.
declare const __MJ_EXPOSE__: boolean;

function boot() {
  // Warm the container codec at boot so the first Save/Open does not pay the
  // WASM instantiation. Failure is not fatal — save/open init lazily too and
  // will surface the real error there.
  void initMonetFormat().catch((e) => console.error("Monet format init failed:", e));
  const root = createRoot(document.getElementById("root")!);
  try {
    store.replaceProject(createProject("Untitled"));
    store.setReady(true);
    // #506: gate window close / ⌘Q / Dock Quit / logout on the unsaved-work check.
    void installUnsavedWorkGuard(store);

    // Start the local MCP server bridge — native desktop only (it talks to the
    // Rust host over Tauri events). Dynamically imported so it's tree-shaken
    // from the browser bundle.
    if (isTauri()) {
      void import("./mcp").then((m) => m.startJouerMcp()).catch((e) => console.error("MCP bridge failed:", e));
    }

    if (import.meta.env.DEV || __MJ_EXPOSE__) {
      // Full app API for e2e / scripted verification (tree-shaken from a normal
      // production build; gated by DEV || __MJ_EXPOSE__).
      void Promise.all([
        import("./commands"),
        import("./model/query"),
        import("./model/sample"),
        import("./io/jouer"),
        import("./io/export-phaser"),
        import("./phaser/PhaserStage"),
        import("./phaser/engines"),
        import("./phaser/player"),
      ]).then(([cmd, query, sample, jouer, exporter, stage, engines, player]) => {
        (window as unknown as { __mj: unknown }).__mj = {
          store,
          cmd,
          query,
          sample,
          jouer,
          exporter,
          probe: stage.editorProbe,
          camera: stage.editorCamera,
          frameSelected: stage.frameSelection,
          moveToView: stage.moveToView,
          engines,
          player,
        };
      });
    }

    root.render(
      // Jouer's "play" green is applied app-wide via styles.css (--accent) and
      // the DockableWorkspace accent prop, so no accent override is needed here.
      <MonetProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </MonetProvider>,
    );
  } catch (e) {
    console.error("Monet Jouer failed to start:", e);
    root.render(<BootError title="Monet Jouer couldn’t start" detail={e instanceof Error ? e.message : String(e)} />);
  }
}

boot();
