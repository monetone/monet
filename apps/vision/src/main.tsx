import { createRoot } from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import "@monet-ui/monet-core/index.css";
import "./styles.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { App } from "./App";
import { ErrorBoundary, BootError } from "./ui/ErrorBoundary";
import { initEngine } from "./engine/EngineClient";
import { createVectorFontProvisioner, provisionSystemVectorFonts } from "./engine/vectorFonts";
import { addDiscoveredFonts } from "./text/spec";
import { setFontFaces } from "./state/fontStyles";
import { store, engine, startVisionCollab, installUnsavedWorkGuard, cameraRawProfileStorage } from "./state/app";
import { collabEnabled } from "./collab";

// Build-time flag (vite define): exposes __mv in a production bundle for the
// "desktop" e2e project. False (and tree-shaken) in normal builds.
declare const __MV_EXPOSE__: boolean;

// Mark browser builds so app-scoped CSS can strip the in-window window controls.
const WEB = !isTauri();
if (WEB && typeof document !== "undefined") document.documentElement.setAttribute("data-mv-web", "");

async function boot() {
  const root = createRoot(document.getElementById("root")!);
  try {
    await initEngine();
    // The Camera Raw profile library needs the engine to read its profiles.
    void store.attachCameraRawProfileStorage(cameraRawProfileStorage());
    // A cold launch lands on the Home start screen (no document) like Photoshop
    // (#476). A collab room is the exception: it shares the ONE document open
    // when the session starts (#80), so it still boots the blank 1280×800 canvas
    // — created before joining so an initial Yjs sync can replay the room's
    // historical strokes instead of dropping them during async boot.
    if (collabEnabled()) store.newDocument(1280, 800, "Untitled.psd", "white", 1, { pristineBlank: true });
    startVisionCollab();
    // Quitting or closing the window must prompt for unsaved documents the way
    // closing a tab does. (#54)
    void installUnsavedWorkGuard();
    if (!WEB) {
      // Serialized + debounced so a boot scan and document open/mutate/revert
      // notifications never run overlapping disk scans, and a burst of per-edit
      // notifications recomputes the document-font signature at most once per
      // window; unchanged signatures skip re-scanning entirely.
      const provisionVectorFonts = createVectorFontProvisioner({
        getDocumentFontStacks: () => store.vectorFontStacksForOpenDocs(),
        provision: (documentFontStacks) =>
          provisionSystemVectorFonts(engine, {
            documentFontStacks,
            onFontsChanged: () => store.refreshVectorFontsForOpenDocs(),
            // Real subfamilies + variable axes for the Character panel's Style
            // dropdown and axis sliders; fires before the families callback, so
            // that one repaint already has this scan's styles.
            onFacesDiscovered: (faces) => {
              if (setFontFaces(faces)) store.bump();
            },
            onFamiliesDiscovered: (families) => {
              if (addDiscoveredFonts(families)) store.bump();
            },
          }),
        onError: (e) => console.warn("Vector font provisioning failed:", e),
        debounceMs: 250,
      });
      store.onVectorFontTargetsChanged = () => {
        void provisionVectorFonts();
      };
      // A document opened before this hook was assigned (the collab canvas
      // above) notified nobody; this explicit forced scan covers it.
      void provisionVectorFonts(true);
    }
    if (import.meta.env.DEV || __MV_EXPOSE__) {
      // Expose the entire app API for e2e tests / scripted verification.
      const api = await import("./state/app");
      const macMenu = await import("./native/macMenu");
      const { snapToGuides } = await import("./canvas/CanvasView");
      // The browser build never runs the Tauri font scan, so e2e feeds real faces through these.
      const fonts = { ...(await import("./state/fontStyles")), ...(await import("./engine/vectorFonts")) };
      (window as unknown as { __mv: unknown }).__mv = { ...api, store, engine, macMenu, snap: snapToGuides, fonts };
    }
    // Start the local MCP server bridge — native desktop only (it talks to the
    // Rust host over Tauri events). Dynamically imported so it's tree-shaken
    // from the browser bundle.
    if (!WEB) {
      void import("./mcp").then((m) => m.startVisionMcp()).catch((e) => console.error("MCP bridge failed:", e));
    }
    root.render(
      // Web: full-bleed app with an in-window menu bar (File/Edit/Image/…). We
      // pick the "win" platform purely so the menu renders in-window (macOS keeps
      // its menus in a global bar a browser doesn't have). The window
      // controls/app-icon that "win" would draw are hidden by app CSS (scoped to
      // [data-mv-web]).
      // In Tauri, pass nothing so the native desktop builds behave exactly as before.
      <MonetProvider
        config={WEB ? { platform: "win" } : undefined}
      >
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </MonetProvider>,
    );
  } catch (e) {
    // A WASM/engine init failure would otherwise leave a blank window with only
    // an unhandled rejection. Surface it instead (see review Quality C1 / OPS1).
    console.error("Monet Vision failed to start:", e);
    root.render(<BootError title="Monet Vision couldn’t start" detail={e instanceof Error ? e.message : String(e)} />);
  }
}

void boot();
