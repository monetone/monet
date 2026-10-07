// Guards vis-type-07: Character and Paragraph are real dockable panels, not a
// re-open of the modal Type dialog. Panels.tsx is a React module that pulls the
// WASM engine through state/app, so it can't be imported in the Node unit run —
// the wiring is asserted from source, the same discipline as windowMenu.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPhotoshopMenus } from "./psMenus";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const panelsSource = readFileSync(new URL("./Panels.tsx", import.meta.url), "utf8");

describe("Character / Paragraph dock panels", () => {
  it("registers both panels in App's dock inventory", () => {
    expect(appSource).toMatch(/character: \{ title: "Character",[^\n]* render: \(\) => <CharacterPanel \/> \}/);
    expect(appSource).toMatch(/paragraph: \{ title: "Paragraph",[^\n]* render: \(\) => <ParagraphPanel \/> \}/);
    expect(appSource).toMatch(/import \{[^}]*\bCharacterPanel\b[^}]*\bParagraphPanel\b[^}]*\} from "\.\/ui\/Panels"/);
  });

  it("opens the docked panels from Type ▸ Panels instead of the Type dialog", () => {
    const character = appSource.match(/^ {4}characterpanel: (.*)$/m)?.[1] ?? "";
    const paragraph = appSource.match(/^ {4}paragraphpanel: (.*)$/m)?.[1] ?? "";
    expect(character).toContain('dockRef.current?.openPanel("character")');
    expect(paragraph).toContain('dockRef.current?.openPanel("paragraph")');
    // The whole point of the gap: no modal covering the canvas.
    expect(character).not.toContain('open("type")');
    expect(paragraph).not.toContain('open("type")');
  });

  it("exports both panel components", () => {
    expect(panelsSource).toContain("export function CharacterPanel()");
    expect(panelsSource).toContain("export function ParagraphPanel()");
  });

  it("formats the on-canvas selection as runs, falling back to the whole layer", () => {
    // typeFormatRange collapses an empty caret to [0, len] (Photoshop's
    // "nothing selected = format everything") and clamps to the string.
    expect(panelsSource).toContain("return a === b ? [0, len] : [a, b];");
    expect(panelsSource).toContain("const [a, b] = typeFormatRange(len, editorSelection());");
    expect(panelsSource).toContain("text.applyRangeFormat(spec.runs, a, b, p)");
  });

  it("keeps leading reachable from the Character panel", () => {
    expect(panelsSource).toMatch(/aria-label="Leading"[^>]*onChange=\{\(v\) => patch\(\{ leading: v \}\)\}/);
  });

  it("mirrors the engine spec instead of snapshotting it once", () => {
    // Undo/redo and the type options bar must be reflected while the panel is
    // docked — the local copy is only there to keep the inputs cursor-safe.
    expect(panelsSource).toContain("if (engineJson !== pushed.current) { pushed.current = engineJson; setSpec(engineSpec); current = engineSpec; }");
  });

  it("lists both panels in the Window menu once App registers them", () => {
    const bar = buildPhotoshopMenus({}, [], () => {}, {
      workspaces: [],
      onApplyWorkspace: () => {},
      panels: [
        { id: "character", title: "Character" },
        { id: "paragraph", title: "Paragraph" },
      ],
      openPanelIds: new Set(["character"]),
      onOpenPanel: () => {},
      documents: [],
      activeDocumentId: "1",
      onActivateDocument: () => {},
    });
    const win = bar.find((menu) => menu.id === "window")!;
    expect(win.items!.find((i) => i.id === "panel-character")?.checked).toBe(true);
    expect(win.items!.find((i) => i.id === "panel-paragraph")).toBeTruthy();
  });
});
