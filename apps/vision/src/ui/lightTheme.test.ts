// @vitest-environment jsdom
// Light theme: the list and the taskbar stay on a near-black surface, so their
// text has to stay light even when a later one-class rule tries to paint it black.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("light theme foregrounds", () => {
  it("keeps list options and taskbar buttons light on the dark surface", () => {
    expect(css).toContain(".monet-listbox .monet-option:hover");
    const style = document.createElement("style");
    // A one-class rule AFTER the sheet is what a light theme would do. The
    // two-class Vision rules have to win anyway.
    style.textContent = `${css}\n.monet-option { color: rgb(0, 0, 0); }\n`;
    document.head.appendChild(style);
    const host = document.createElement("div");
    host.innerHTML = `
      <div class="monet-listbox"><div class="monet-option">Plain</div></div>
      <div class="monet-listbox"><div class="monet-option" aria-disabled="true">Off</div></div>
      <div class="monet-listbox"><div class="monet-option" aria-selected="true"><span>On</span></div></div>
      <button class="mv-taskbar-btn">Secondary</button>
      <button class="mv-taskbar-btn mv-taskbar-primary">Primary</button>
      <button class="mv-taskbar-btn mv-taskbar-close">Close</button>
    `;
    document.body.appendChild(host);
    const color = (selector: string) => getComputedStyle(host.querySelector(selector)!).color;
    expect(color(".monet-option")).toBe("rgb(231, 237, 248)");
    expect(color('[aria-disabled="true"]')).toBe("rgb(231, 237, 248)");
    expect(color('[aria-selected="true"]')).toBe("rgb(255, 255, 255)");
    expect(color('[aria-selected="true"] span')).toBe("rgb(255, 255, 255)");
    expect(color(".mv-taskbar-btn")).toBe("rgb(231, 237, 248)");
    expect(color(".mv-taskbar-primary")).toBe("rgb(255, 255, 255)");
    expect(color(".mv-taskbar-close")).toBe("rgb(231, 237, 248)");
    host.remove();
    style.remove();
  });
});
