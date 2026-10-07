// #448: Oil Paint, Flame and Tree expose their Photoshop control sets, each
// backed by a real engine parameter.
//
// The action half is driven for real: the WASM engine is replaced by a
// recording stand-in (the smartFilterWiring.test.ts pattern) and the three
// actions are CALLED, so a control that is not handed to the engine — or a
// Flame seed that is re-rolled per apply instead of carried — fails here.
// The menu/dialog half is asserted at source level, the App.tsx/Dialogs.tsx
// idiom from appCommands.test.ts (importing either drags the app into node).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { engine, fil, neural, store } from "./state/app";
import { LAYER_KIND } from "./state/engineContracts";
import { hsvToRgba } from "./state/store";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const dialogsSource = readFileSync(new URL("./ui/Dialogs.tsx", import.meta.url), "utf8");

const smartAdds: { fid: number; params: number[] }[] = [];
const engineCalls: [string, unknown[]][] = [];

/** Engine stand-in: records smart-stack pushes and every other engine call. */
function installEngine(layerKind: number) {
  smartAdds.length = 0;
  engineCalls.length = 0;
  const target: Record<string, unknown> = {
    layer_kind: () => layerKind,
    undo_pushes: () => 0,
    smart_add_filter: (_layer: number, fid: number, params: Float32Array) => { smartAdds.push({ fid, params: Array.from(params) }); },
  };
  engine.onSync = null;
  engine.engine = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return (...args: unknown[]) => { engineCalls.push([prop, args]); return 0; };
    },
    has() { return true; },
  }) as never;
}

const engineCall = (name: string) => engineCalls.filter(([n]) => n === name).map(([, args]) => args);

function dialog(name: string): string {
  const start = dialogsSource.indexOf(`\nfunction ${name}() {`);
  expect(start, `dialog ${name}`).toBeGreaterThan(0);
  return dialogsSource.slice(start, dialogsSource.indexOf("\n}\n", start));
}

describe("Filter ▸ Render ▸ Flame (#448)", () => {
  it("opens a dialog from the menu instead of firing with a random seed", () => {
    expect(appSource).toContain('    flame: () => open("flame"),');
    expect(appSource).not.toContain("flame: () => fil.flame()");
    expect(dialogsSource).toContain('case "flame": return <Flame />;');
  });

  it("previews live with length, width, turbulence, opacity and a reproducible seed", () => {
    const body = dialog("Flame");
    expect(body).toContain("<PreviewDialog title=\"Flame\" deps={[length, width, turbulence, opacity, seed]}");
    for (const label of ["Length", "Width", "Turbulence", "Opacity"]) expect(body).toContain(`<Row label="${label}"`);
    expect(body).toContain("Random Seed");
    expect(body).toContain('aria-label="Randomize shapes"');
    // The seed is dialog state: a fresh Math.random per apply would make OK
    // draw a different fire from the one being previewed.
    expect(body).toContain("const [seed, setSeed] = useState(randomSeed);");
    expect(body).toContain("fil.flame(length, width, turbulence, opacity / 100, seed)");
  });

  it("carries the controls and the seed into the engine call and the smart params", () => {
    const [r, g, b] = hsvToRgba(store.state.fg);
    installEngine(LAYER_KIND.pixel);
    fil.flame(40, 12, 60, 0.5, 4242);
    fil.flame(40, 12, 60, 0.5, 4242);
    expect(engineCall("filter_flame")).toEqual([[4242, r, g, b, 40, 12, 60, 0.5], [4242, r, g, b, 40, 12, 60, 0.5]]);
    installEngine(LAYER_KIND.smartObject);
    fil.flame(40, 12, 60, 0.5, 4242);
    expect(smartAdds).toEqual([{ fid: 29, params: [4242, r, g, b, 40, 12, 60, 0.5] }]);
    expect(engineCall("filter_flame")).toEqual([]);
  });
});

describe("Filter ▸ Render ▸ Tree (#448)", () => {
  it("previews live with leaves, height, thickness and light-direction controls", () => {
    const body = dialog("Tree");
    expect(body).toContain("<PreviewDialog title=\"Tree\" deps={[angle, depth, leavesAmount, leavesSize, height, thickness, light]}");
    for (const label of ["Light Direction", "Leaves Amount", "Leaves Size", "Branches Height", "Branches Thickness", "Branch Angle", "Branches"]) {
      expect(body).toContain(`<Row label="${label}"`);
    }
    expect(body).toContain("fil.tree(angle, Math.round(depth), r0, g0, b0, leavesAmount, leavesSize, height, thickness, light)");
  });

  it("hands all ten parameters to the engine and bakes them into the smart params", () => {
    installEngine(LAYER_KIND.pixel);
    fil.tree(25, 9, 80, 50, 20, 70, 120, 150, 80, 45);
    expect(engineCall("filter_tree")).toEqual([[25, 9, 80, 50, 20, 70, 120, 150, 80, 45]]);
    installEngine(LAYER_KIND.smartObject);
    fil.tree(25, 9, 80, 50, 20, 70, 120, 150, 80, 45);
    expect(smartAdds).toEqual([{ fid: 28, params: [25, 9, 80, 50, 20, 70, 120, 150, 80, 45] }]);
  });
});

describe("Filter ▸ Stylize ▸ Oil Paint (#448)", () => {
  it("exposes Photoshop's Brush and Lighting controls with a live preview", () => {
    const body = dialog("OilPaint");
    expect(body).toContain("<PreviewDialog title=\"Oil Paint\" deps={[stylization, cleanliness, scale, bristle, angle, shine]}");
    for (const label of ["Stylization", "Cleanliness", "Scale", "Bristle Detail", "Angle", "Shine"]) expect(body).toContain(`<Row label="${label}"`);
    expect(body).not.toContain("Stroke radius");
  });

  it("hands the six controls to the engine on the Oil Paint fid", () => {
    installEngine(LAYER_KIND.pixel);
    neural.oilPaint(2.5, 5, 3, 4, 90, 2);
    expect(engineCall("filter_oil_paint")).toEqual([[2.5, 5, 3, 4, 90, 2]]);
    expect(engineCall("filter_oil")).toEqual([]);
    installEngine(LAYER_KIND.smartObject);
    neural.oilPaint(2.5, 5, 3, 4, 90, 2);
    // Six params on fid 12 — the engine tells this layout from the legacy
    // single-radius one by length, so old stacks keep rendering.
    expect(smartAdds).toEqual([{ fid: 12, params: [2.5, 5, 3, 4, 90, 2] }]);
  });
});

beforeEach(() => installEngine(LAYER_KIND.pixel));
