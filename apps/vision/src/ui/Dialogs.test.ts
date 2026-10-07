import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { canvasSizeFits } from "../state/canvasAnchor";
import { imageSizeToPixels } from "../state/docPresets";

// Dialogs.tsx pulls the WASM engine through state/app, so it can't be imported
// in the Node unit run — the wiring is asserted from source, the same discipline
// as ./uiEditContracts.test.ts, with the pure maths modelled alongside the
// anchor so a regression reads as failing behaviour and not a missing string.
const src = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");
const storeSrc = readFileSync(fileURLToPath(new URL("../state/store.ts", import.meta.url)), "utf8");

function section(start: string, end: string): string {
  const from = src.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = src.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return src.slice(from, to);
}

describe("Color Settings ▸ Load… survives a cancelled picker (#99)", () => {
  const picker = () => section("function pickCsfFile()", "\n}\n");

  it("settles the promise and removes the input on `cancel`, not only on `change`", () => {
    expect(picker()).toContain("input.oncancel = () => settle(null);");
  });

  it("removes the hidden input on every settled path", () => {
    // One shared settle() — a resolve that skips input.remove() leaks a node per
    // cancelled attempt, which is half of what the hang made invisible.
    const body = picker();
    expect(body).toContain("const settle = (file: File | null) => { input.remove(); resolve(file); };");
    expect(body.match(/resolve\(/g), "resolve must only be reached through settle()").toHaveLength(1);
  });
});

describe("Render Video normalizes an inverted frame range (#100)", () => {
  it("orders the two independent fields before handing them to exportVideo", () => {
    const render = section("function RenderVideoDialog()", "return (");
    expect(render).toContain("const lo = Math.min(from, to), hi = Math.max(from, to);");
    expect(render).toContain("{ from: lo - 1, to: hi - 1,");
    expect(render, "an unordered range renders a single frame instead of the span").not.toContain("{ from: from - 1, to: to - 1,");
  });

  it("models recordVideo's clamp: 'from 5 to 2' has to reach it as frames 2..5", () => {
    // state/app.ts recordVideo: `to` is clamped up to `from`, so an unordered
    // pair silently collapses to a one-frame video of the higher frame.
    const clamped = (from: number, to: number, count: number) => {
      const f = Math.max(0, Math.min(from, count - 1));
      return [f, Math.max(f, Math.min(to, count - 1))];
    };
    const [from, to] = [5, 2];
    expect(clamped(from - 1, to - 1, 10)).toEqual([4, 4]);
    const lo = Math.min(from, to), hi = Math.max(from, to);
    expect(clamped(lo - 1, hi - 1, 10)).toEqual([1, 4]);
  });
});

describe("Scale Effects / Global Light drop an unchanged snapshot (#101)", () => {
  for (const [dialog, command] of [["function ScaleEffects()", "scaleEffects"], ["function GlobalLight()", "setGlobalLight"]] as const) {
    it(`${dialog} routes through one recordable compound store command`, () => {
      const end = "return (";
      const apply = section(dialog, end);
      expect(apply).toContain(`store.${command}(`);
      expect(apply, "the dialog must stay on its opening target").toContain("engine.engine !== targetEngine");
      const from = storeSrc.indexOf(`  ${command}(`);
      const to = storeSrc.indexOf("\n  }", from) + 4;
      const body = storeSrc.slice(from, to);
      expect(body).toContain("this.beginHistory(");
      expect(body, "a no-op OK leaves a phantom undo step").toContain("this.dropHistory()");
      expect(body, "a real edit must close the transaction").toContain("this.commitHistory()");
      expect(body).toContain("changed = true;");
    });
  }
});

describe("Image Size refuses an over-budget request visibly (#160)", () => {
  const dialog = () => section("function ImageSize()", "function ExpandContract()");

  it("gates Resize on the same budget Canvas Size enforces", () => {
    const body = dialog();
    expect(body).toContain("const oversized = !canvasSizeFits(wPx, hPx);");
    expect(body).toContain('<Button variant="primary" disabled={oversized}');
    expect(body).toContain('role="alert"');
    expect(body, "the resize must use the checked pixel values").toContain("xform.resizeImage(wPx, hPx);");
  });

  it("models the headline case: 4000×3000 at 500% is over the engine's budget", () => {
    const wPx = imageSizeToPixels(500, "percent", 4000, 72), hPx = imageSizeToPixels(500, "percent", 3000, 72);
    expect([wPx, hPx]).toEqual([20000, 15000]);
    expect(canvasSizeFits(wPx, hPx), "resize_image would return silently").toBe(false);
    // …and an ordinary resize still passes the gate.
    expect(canvasSizeFits(imageSizeToPixels(50, "percent", 4000, 72), imageSizeToPixels(50, "percent", 3000, 72))).toBe(true);
  });
});

// #442 — the four Image ▸ Mode / Adjustments dialogs that shipped without their
// core Photoshop options. The pixel behaviour is covered in packages/engine and
// the store seam in ../state/modeConversionOptions.test.ts; what is asserted
// here is that the controls exist in the dialog and reach those calls, which is
// the half that makes any of it reachable.
describe("Indexed Color exposes the Palette menu, Forced colors and the matte (#442)", () => {
  const dialog = () => section("function IndexedColor()", "// Image ▸ Mode ▸ Duotone");

  it("offers Photoshop's nine palettes and four Forced entries in the engine's order", () => {
    expect(src).toContain('const INDEXED_PALETTES = ["Exact", "System", "Web", "Uniform", "Perceptual", "Selective", "Adaptive", "Custom", "Previous"];');
    expect(src).toContain('const INDEXED_FORCED = ["None", "Black and White", "Primaries", "Web"];');
    const body = dialog();
    expect(body).toContain('<Select block aria-label="Palette"');
    expect(body).toContain('<Select block aria-label="Forced"');
  });

  it("loads a .act as the Custom table, and keeps Colors off the fixed palettes", () => {
    const body = dialog();
    expect(body).toContain("const table = await loadColorTableAct();");
    expect(body).toContain('setPalette("7")');
    expect(body).toContain("const fixed = INDEXED_FIXED_COLORS.includes(palette);");
    expect(body).toContain("disabled={fixed}");
  });

  // Exact, System, Web, Custom and Previous carry their own table: Photoshop greys
  // Colors out for them, and a Colors of 16 left over from Adaptive must not
  // truncate the 216-entry web cube on the way to the engine.
  it("hands a fixed palette all 256 slots rather than the greyed-out Colors field", () => {
    expect(src).toContain('const INDEXED_FIXED_COLORS = ["0", "1", "2", "7", "8"];');
    expect(dialog()).toContain("const slots = fixed ? 256 : Math.round(colors);");
  });

  it("hands all of it to one store call, with a matte that stays live", () => {
    const body = dialog();
    expect(body).toContain("store.convertIndexed(slots, dither, +palette, +forced, transparency, matte, custom)");
    expect(body).toContain("<Checkbox checked={transparency} onChange={setTransparency}>Transparency</Checkbox>");
    // The engine mattes soft edges under Transparency too (an indexed image has
    // no partial alpha), so disabling the picker would lie about what OK does.
    expect(body).toContain('<input type="color" value={matte} aria-label="Matte"\n');
    expect(body).not.toContain('aria-label="Matte" disabled={transparency}');
  });
});

describe("Bitmap exposes the output resolution and the halftone screen (#442)", () => {
  const dialog = () => section("function Bitmap()", "function Displace()");

  it("shows the document's input resolution and edits the output one", () => {
    const body = dialog();
    expect(body).toContain("const input = useStore((s) => s.resolutionPpi);");
    expect(body).toContain("<NumberField value={output} min={1} max={BITMAP_MAX_OUTPUT_PPI} onChange={setOutput} suffix=\"ppi\" />");
  });

  it("adds the two engine methods the dialog could not reach, and the screen's three fields", () => {
    const body = dialog();
    expect(body).toContain('{ value: "3", label: "Halftone Screen" }');
    expect(body).toContain('{ value: "4", label: "Custom Pattern" }');
    expect(src).toContain('const HALFTONE_SHAPES = ["Round", "Diamond", "Ellipse", "Line", "Square", "Cross"];');
    for (const field of ["value={frequency}", "value={angle}", 'aria-label="Shape"']) expect(body).toContain(field);
  });

  it("sends the screen only with the Halftone method, so the other four keep their own path", () => {
    expect(dialog()).toContain('store.convertBitmap(+method, method === "3" ? frequency : 0, angle, +shape, output)');
  });
});

describe("Color Table loads, edits and applies the document palette (#442)", () => {
  const dialog = () => section("function ColorTable()", "// Edit ▸ Presets ▸ Preset Manager");

  it("replaces the table from an .act instead of only merging it into Swatches", () => {
    const body = dialog();
    expect(body).toContain("const next = await loadColorTableAct();");
    expect(body).toContain("data-mv-colortable-load");
  });

  it("makes every entry click-editable, and saves what is edited", () => {
    const body = dialog();
    expect(body).toContain('<input key={i} type="color" value={hex}');
    expect(body).toContain("onChange={(e) => editEntry(i, e.currentTarget.value)}");
    expect(body, "Save must write the edited table, not the untouched composite")
      .toContain('exportColorTableAct("color-table.act", table)');
  });

  it("applies it through Indexed Color ▸ Custom, paired with the palette it opened on", () => {
    const body = dialog();
    // The palette the document holds goes with the edited one: without it
    // convertIndexed re-quantizes, and an edited swatch snaps back onto whichever
    // old colour stayed nearest instead of recolouring its own pixels. What
    // colorTableHexes returns (the document palette) is pinned in
    // state/app.test.ts, and the remap across layers in packages/engine.
    expect(body).toContain('store.convertIndexed(table.length, false, 7, 0, true, "#ffffff", table, original);');
    expect(body, "the pairing must come from the document, not the edited grid")
      .toContain("const [original] = useState<string[]>(colorTableHexes);");
    expect(body).toContain('title="Re-index the document to this table"');
  });
});

describe("Keyboard Shortcuts never loses a saved set library it could not read (#483)", () => {
  const dialog = () => section("function KeyboardShortcuts()", "Shortcut and saved-set changes apply with OK.");
  const body = (start: string, end: string) => {
    const src = dialog();
    const from = src.indexOf(start);
    expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
    return src.slice(from, src.indexOf(end, from + start.length));
  };

  it("does not count Reset All or picking a set as a library change when the library failed to load", () => {
    // OK writes `sets` whenever setsChanged is true. After a load error `sets` is
    // empty, so a bare selection (Reset All ▸ chooseSet("")) must not arm that write.
    const choose = body("const chooseSet = (name: string) => {", "\n  };");
    expect(choose, "chooseSet must not unconditionally mark the library changed").not.toContain("setSetsChanged(true)");
    expect(choose).toContain("initialSets.error");
    expect(dialog()).toContain("if (setsChanged) saveShortcutSets(sets, setName);");
  });

  it("still saves the library after an explicit save, import, or delete", () => {
    expect(body("const saveSet = ", "\n  };")).toContain("setSetsChanged(true)");
    expect(body("const importSet = ", "\n  };")).toContain("setSetsChanged(true)");
    expect(body("setSets(sets.filter((set) => set.name !== setName));", "}}>Delete Set")).toContain("setSetsChanged(true)");
  });

  it("closes only the naming row on Escape, so the dialog keeps staged changes", () => {
    // useDismiss skips an Escape whose default was prevented; without that the
    // Dialog closes and discards every staged set and chord change.
    const keys = body('aria-label="New shortcut set name"', "Create Set");
    expect(keys).toContain('"Escape"');
    expect(keys).toContain("event.preventDefault()");
    expect(keys).toContain("setNewName(null)");
  });
});

describe("Shadows/Highlights gains Radius per band and the clips (#442)", () => {
  const dialog = () => section("function ShadowsHighlights()", "// A stable, lightweight per-filter swatch gradient");

  it("puts a Radius in each band and both clips under Adjustments", () => {
    const body = dialog();
    expect(body).toContain('<Row label="Radius" value={sr} min={0} max={2500} onChange={setSr} suffix="px" />');
    expect(body).toContain('<Row label="Radius" value={hr} min={0} max={2500} onChange={setHr} suffix="px" />');
    expect(body).toContain('<Row label="Black Clip" value={blackClip} min={0} max={50} decimals={2} onChange={setBlackClip} suffix="%" />');
    expect(body).toContain('<Row label="White Clip" value={whiteClip} min={0} max={50} decimals={2} onChange={setWhiteClip} suffix="%" />');
  });

  it("previews on them too — a slider outside deps is a control that does nothing", () => {
    expect(dialog()).toContain("deps={[sa, sw, ha, hw, color, midtone, sr, hr, blackClip, whiteClip]}");
  });

  it("sends the percentages as fractions and the radii as pixels, in the engine's order", () => {
    expect(dialog()).toContain("adj.shadowsHighlights(sa / 100, sw / 100, ha / 100, hw / 100, color / 100, midtone / 200, sr, hr, blackClip / 100, whiteClip / 100)");
    // fid 101's params are positional: a re-edited smart filter reads them back
    // through SMART_FILTER_PARAMS, so the panel's row list has to match.
    const panels = readFileSync(fileURLToPath(new URL("./Panels.tsx", import.meta.url)), "utf8");
    const spec = panels.slice(panels.indexOf("  101: ["), panels.indexOf("  102: ["));
    for (const label of ["Shadow Radius", "Highlight Radius", "Black Clip", "White Clip"]) {
      expect(spec, `Shadows/Highlights ▸ ${label} is re-editable`).toContain(label);
    }
  });
});

describe("Script Events and Variables dialogs keep Cancel honest and explain refusals (#475)", () => {
  it("writes Script Events bindings only from Done, so Cancel discards Add, Remove and Enable", () => {
    const dialog = section("function ScriptEventsManagerDialog()", "\nfunction RenderVideoDialog()");
    expect(dialog.match(/saveScriptEvents\(/g), "only Done may persist the bindings").toHaveLength(1);
    expect(dialog).toContain("if (saveScriptEvents({ enabled, bindings })) close();");
    expect(dialog).toContain('<Button variant="ghost" onClick={close}>Cancel</Button>');
  });

  it("offers Pixel Replacement only where dataVars.apply can read an image path", () => {
    // dataVars.apply refuses every pixel binding outside Tauri.
    const dialog = section("function VariablesDefine()", "\nfunction DataSets()");
    expect(dialog).toContain('{ value: "pixel", label: "Pixel Replacement (Conform)", disabled: !isTauri() }');
    expect(dialog).toContain("Monet Vision desktop app");
  });

  it("shows why a data set could not be applied in the dialog, not only in a toast", () => {
    const dialog = section("function DataSets()", "\nfunction ImageProcessor()");
    expect(dialog).toContain("dataVars.apply(active, controller.signal, (message) => { reason = message; })");
    expect(dialog).toContain("setError(reason || ");
  });
});
