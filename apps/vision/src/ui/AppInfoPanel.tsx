import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { engine } from "../state/app";
import { VISION_CONTAINER_APP } from "../state/nativeIoPolicy";

const GITHUB_URL = "https://github.com/monetone/monet";

/** The title-bar app pill's info panel — a compact About in a popover. */
export function AppInfoPanel() {
  let engineBuild = "monet-render-engine · WebAssembly";
  try { engineBuild = `monet-render-engine ${engine.version()} · WebAssembly`; } catch { /* unavailable in a mocked shell */ }
  return (
    <div style={{ minWidth: 240, padding: 12, fontSize: 12, color: "var(--text-2)" }}>
      <strong style={{ fontSize: 13, color: "var(--text-1)" }}>Monet Vision</strong>
      <div style={{ color: "var(--text-3)", marginTop: 2 }}>Raster editing by Monet</div>
      <div style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: "4px 10px", marginTop: 10 }}>
        <strong>Version</strong><span>{VISION_CONTAINER_APP.version}</span>
        <strong>Engine</strong><span style={{ overflowWrap: "anywhere" }}>{engineBuild}</span>
      </div>
      <a href={GITHUB_URL} style={{ display: "inline-block", marginTop: 10, color: "var(--accent)" }}
        onClick={(e) => {
          e.preventDefault();
          if (isTauri()) void openUrl(GITHUB_URL);
          else window.open(GITHUB_URL, "_blank", "noopener");
        }}>
        GitHub
      </a>
    </div>
  );
}
