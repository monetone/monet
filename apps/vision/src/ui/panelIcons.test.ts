// Guards #479: a collapsed dock is a rail of icons, so every Vision panel needs
// its own glyph — without one, monet-react draws the same placeholder for all
// of them and the rail is only readable through tooltips. App.tsx cannot be
// imported under vitest (see tabHideChrome.test.ts), so its panel map is read
// as source and checked against the glyph table it uses.
import { readFileSync } from "node:fs";
import { I } from "@monet-ui/monet-react";
import { expect, it } from "vitest";
import { PANEL_ICONS } from "./panelIcons";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const panelLines = [...(appSource.match(/const panels = \{\n([\s\S]*?)\n {2}\};/)?.[1] ?? "").matchAll(/^ {4}(\w+): \{ title: .*$/gm)];

it("gives every Vision panel its own collapsed-rail icon (#479)", () => {
  expect(panelLines.length).toBeGreaterThan(20);
  for (const [line, id] of panelLines) expect(line, id).toContain(`icon: <Icon d={PANEL_ICONS.${id}} />`);
  const glyphs = panelLines.map(([, id]) => PANEL_ICONS[id as keyof typeof PANEL_ICONS]);
  expect(glyphs.every(Boolean)).toBe(true);
  expect(new Set(glyphs).size).toBe(glyphs.length);
  expect(glyphs).not.toContain(I.gradient);
});
