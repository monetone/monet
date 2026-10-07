// @vitest-environment jsdom
// Guards VIS-WS-03: Photoshop's Tab / ⇧Tab chrome hiding. Tab hides panels *and*
// the tool rail + options bar, ⇧Tab hides panels only, either restores.
//
// The stylesheet is lifted out of App.tsx and then actually *run* in a document:
// what is asserted below is what the browser computes for each piece of chrome
// at each level, not the text of the rules. App.tsx itself cannot be imported —
// monet-react is a workspace source dep that resolves its own React copy, so
// mounting the shell throws "Invalid hook call" under vision's vitest
// resolution — so the two pieces that live only inside the component (the
// <style> mount and the Tab keydown branch) stay source-level guards, marked as
// such where they appear.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

/** The chrome-hiding stylesheet exactly as App.tsx ships it. */
const CHROME_HIDE_CSS = (() => {
  const css = appSource.match(/const CHROME_HIDE_CSS = `([\s\S]*?)`;/)?.[1];
  if (!css) throw new Error("CHROME_HIDE_CSS template literal not found in App.tsx");
  return css;
})();

const PANEL_CHROME = [".monet-dock", ".monet-float", ".monet-split"];
const TOOLBAR_CHROME = [".monet-toolbar", ".monet-tb-lanes", ".monet-tb-strip"];
const ALL_CHROME = [...PANEL_CHROME, ...TOOLBAR_CHROME, ".mv-taskbar"];

let style: HTMLStyleElement;

/** Mount the real stylesheet over one element per chrome class. */
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = CHROME_HIDE_CSS;
  document.head.appendChild(style);
  for (const sel of ALL_CHROME) {
    const el = document.createElement("div");
    el.className = sel.slice(1);
    document.body.appendChild(el);
  }
});

afterEach(() => {
  style.remove();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-mv-chrome-hidden");
});

/** Drive the level App.tsx mirrors onto <html>: "" = visible, "panels", "all". */
function setLevel(level: string): void {
  const root = document.documentElement;
  if (level) root.setAttribute("data-mv-chrome-hidden", level);
  else root.removeAttribute("data-mv-chrome-hidden");
}

const hidden = (sel: string) => getComputedStyle(document.querySelector(sel)!).display === "none";

describe("Vision Tab / ⇧Tab chrome hiding", () => {
  it("shows everything when no level is set", () => {
    setLevel("");
    for (const sel of ALL_CHROME) expect(hidden(sel), sel).toBe(false);
  });

  it("hides panel docks, floats and their splitters at either level", () => {
    for (const level of ["panels", "all"]) {
      setLevel(level);
      for (const sel of [...PANEL_CHROME, ".mv-taskbar"]) expect(hidden(sel), `${sel} @ ${level}`).toBe(true);
    }
  });

  it("keeps the tool rail and options bar visible under ⇧Tab", () => {
    // The whole point of the two levels: the bare attribute must not touch the
    // relocatable toolbars, or ⇧Tab would behave identically to Tab.
    setLevel("panels");
    for (const sel of TOOLBAR_CHROME) expect(hidden(sel), sel).toBe(false);
  });

  it("hides the tool rail and options bar too under Tab", () => {
    setLevel("all");
    for (const sel of TOOLBAR_CHROME) expect(hidden(sel), sel).toBe(true);
  });

  it("restores every piece of chrome when the level is cleared", () => {
    setLevel("all");
    setLevel("");
    for (const sel of ALL_CHROME) expect(hidden(sel), sel).toBe(false);
  });

  it("wins over an inline display, so nothing survives a hide", () => {
    // `!important` is load-bearing: the dock manager sets inline display on the
    // panels it lays out, and a plain rule would lose to it.
    setLevel("all");
    for (const sel of ALL_CHROME) {
      (document.querySelector(sel) as HTMLElement).style.display = "flex";
      expect(hidden(sel), sel).toBe(true);
    }
  });

  // Source-level: the <style> mount and the attribute mirroring live inside the
  // App component body, which cannot be rendered here (see the file header).
  it("renders the stylesheet and mirrors the level onto the document root", () => {
    expect(appSource).toContain("<style>{CHROME_HIDE_CSS}</style>");
    expect(appSource).toContain('root.setAttribute("data-mv-chrome-hidden", chromeHidden)');
    expect(appSource).toContain('root.removeAttribute("data-mv-chrome-hidden")');
  });
});

// Source-level: the Tab branch is an inline closure in App.tsx's window keydown
// handler (see the file header for why the shell cannot be mounted). The level
// values it produces are the ones exercised behaviourally above.
describe("Vision Tab key handling", () => {
  const branch = (() => {
    const start = appSource.indexOf('if (e.key === "Tab"');
    expect(start).toBeGreaterThan(-1);
    const end = appSource.indexOf("\n      }", start);
    expect(end).toBeGreaterThan(start);
    return appSource.slice(start, end);
  })();

  it("toggles: ⇧Tab → panels, Tab → all, anything hidden → visible", () => {
    expect(branch).toContain('setChromeHidden((prev) => (prev ? "" : e.shiftKey ? "panels" : "all"))');
    // Held Tab must not flicker the chrome on every auto-repeat.
    expect(branch).toContain("if (!e.repeat)");
    expect(branch).toContain("e.preventDefault()");
    // ⌘/⌃/⌥+Tab belong to the OS window/app switchers.
    expect(branch).toContain("!meta && !e.altKey");
  });

  it("leaves Tab alone while focus is on an interactive control", () => {
    // Tab is the web's focus-navigation key — swallowing it unconditionally
    // would strand a keyboard user inside the panels.
    expect(branch).toContain('t.closest("button, select, a[href], [tabindex]:not([tabindex=\'-1\'])")');
  });

  it("lets a user shortcut rebound onto Tab win", () => {
    const map = appSource.indexOf("if (command) { clearPendingDigit(); e.preventDefault(); command.run(); return; }");
    expect(map).toBeGreaterThan(-1);
    expect(appSource.indexOf('if (e.key === "Tab"')).toBeGreaterThan(map);
  });
});

describe("Vision Auto-Show Hidden Panels peek", () => {
  it("keeps a peeked dock open while the pointer is on a dropdown it opened", () => {
    // Source-level guard: Select listboxes and menus are portalled into the
    // overlay root, outside the dock, so the pointer on them must still count.
    expect(appSource).toContain("e.target.closest(`.monet-dock--${shown}, #monet-overlay-root`)");
    // …and an open list keeps it up even once the pointer leaves for the canvas.
    expect(appSource).toContain("!!shown && (isDropdownOpen()");
  });
});
