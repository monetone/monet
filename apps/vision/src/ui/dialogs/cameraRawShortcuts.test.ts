import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Source-text wiring assertions, same idiom as ./cameraRawFilterSurface.test.ts
// (the workspace pulls the WASM engine, so DOM behavior belongs to Playwright).
const src = readFileSync(fileURLToPath(new URL("./CameraRawWorkspace.tsx", import.meta.url)), "utf8");

// #31 — the window-level 'Y' before/after toggle fired while the user typed in
// the dialog's own "Preset name" Input: every 'y' in "Sunny Day" flashed the
// preview and left showBefore on the name's parity. Cmd/Ctrl+Y was captured too.
describe("Camera Raw before/after shortcut (#31)", () => {
  const handler = () => {
    const from = src.indexOf("const onKey = (e: KeyboardEvent)");
    expect(from, "missing the window keydown handler").toBeGreaterThanOrEqual(0);
    return src.slice(from, src.indexOf('window.addEventListener("keydown", onKey);', from));
  };

  it("bails out while a text field owns the keyboard", () => {
    expect(handler()).toContain("if (isEditableTarget(e.target)) return;");
  });

  it("leaves modified chords (⌘Y / Ctrl+Y / Alt+Y) alone", () => {
    expect(handler()).toContain("if (e.metaKey || e.ctrlKey || e.altKey) return;");
  });

  it("keeps the guards ahead of the toggle", () => {
    const onKey = handler();
    for (const guard of ["isEditableTarget", "e.metaKey"]) {
      expect(onKey.indexOf(guard), `${guard} guard is missing`).toBeGreaterThanOrEqual(0);
      expect(onKey.indexOf("setShowBefore")).toBeGreaterThan(onKey.indexOf(guard));
    }
  });
});
