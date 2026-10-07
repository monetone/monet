import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ── Window-chrome regression guard ─────────────────────────────────────────
// Monet Vision wears the custom Monet liquid-glass frame: a transparent,
// *decorationless* Tauri window whose title bar (in-window traffic-light
// controls + document tabs) is drawn by @monet-ui/monet-react. It must never
// revert to a native OS title bar — a visible regression that also breaks
// parity with every sibling Monet app.
//
// The two halves are coupled and must BOTH stay off:
//   • Rust  — src-tauri/src/main.rs must not enable window decorations.
//   • React — App.tsx must not pass nativeFrame to <DockableWorkspace>
//             (absent ⇒ the bare custom frame; see dockable.tsx useNativeFrame).
//
// This guard exists because the regression is NATIVE-ONLY: in the browser/e2e
// build `nativeFrame={platform === "mac" && isTauri()}` is always false
// (isTauri() === false), so Playwright can never catch it — a source check is
// the only reliable net. It regressed once in ea78685 and was reverted.
//
// If native decorations ever become a deliberate choice, change the app first,
// then update THIS test on purpose — don't silence it.

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Check CODE only: strip /* */ block comments (incl. JSX {/* */}) and // line
// comments so the anchor comments in main.rs / App.tsx can name the very tokens
// we forbid without tripping the match.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("Vision keeps the custom Monet window frame (no native title bar)", () => {
  it("main.rs builds the window decorationless (never enables decorations)", () => {
    const code = stripComments(read("../../src-tauri/src/main.rs"));
    // Any `.decorations(<arg>)` call must pass exactly `false`; normally there
    // is none at all. `.decorations(true)` / `.decorations(cfg!(...))` — the
    // exact shape of the ea78685 regression — is what this rejects.
    const enabling = [...code.matchAll(/\.decorations\s*\(\s*([^)]*)/g)]
      .map((m) => m[1].trim())
      .filter((arg) => arg !== "false");
    expect(enabling, `main.rs enables native window decorations: ${JSON.stringify(enabling)}`).toEqual([]);
  });

  it("App.tsx never hands <DockableWorkspace> a native frame", () => {
    const code = stripComments(read("../App.tsx"));
    // Absent ⇒ DockableWorkspace renders `.monet-window--bare` (the custom frame).
    expect(
      /nativeFrame\s*=/.test(code),
      "App.tsx passes `nativeFrame` — this switches Vision to native OS decorations",
    ).toBe(false);
  });
});
