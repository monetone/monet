// VIS-LS-03: on a smart object, nothing in the Filter menu may be a silent
// no-op. Every Filter-menu action must land on the smart-filter stack with its
// own fid, and every fid the app passes must have a matching arm in the
// engine's `apply_smart_filter`.
//
// The first half is driven for real here: the WASM engine is replaced by a
// recording stand-in (the app.test.ts pattern) and every action in the `fil` /
// `distort` namespaces is actually CALLED, so a menu item that forgets to route
// through applyFilter fails the sweep instead of merely failing a grep.
//
// The second half stays source-level on purpose: it is a cross-language guard
// between this TypeScript and packages/engine/src/raster/mod.rs, which a node
// test cannot execute. The behavioural half of THAT contract (arms render,
// seeds replay deterministically, refusals are loud) lives in the engine's Rust
// tests (mod.rs › every_filter_menu_fid_lands_on_the_smart_stack et al.).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { adj, applyGalleryBlurPins, applySpinBlurPins, distort, engine, fil, neural, smart, store } from "./app";
import { LAYER_KIND } from "./engineContracts";
import { DEFAULT_LIGHTING } from "./lightingEffects";

const modSrc = readFileSync(
  fileURLToPath(new URL("../../../../packages/engine/src/raster/mod.rs", import.meta.url)),
  "utf8",
);

interface SmartCall { layer: number; fid: number; params: unknown }

const smartAdds: SmartCall[] = [];
const smartUpdates: SmartCall[] = [];
const destructive: string[] = [];

/** Engine stand-in: records the smart-filter stack pushes, answers 0 for the
 *  geometry/state reads the actions make, and logs any destructive kernel. */
function installEngine(layerKind: number) {
  smartAdds.length = 0;
  smartUpdates.length = 0;
  destructive.length = 0;
  let pushes = 0;
  const target: Record<string, unknown> = {
    layer_kind: () => layerKind,
    undo_pushes: () => pushes,
    smart_add_filter: (layer: number, fid: number, params: unknown) => { pushes++; smartAdds.push({ layer, fid, params }); },
    smart_filter_id: (_layer: number, index: number) => index === 0 ? 114 : -1,
    smart_update_filter: (layer: number, index: number, params: unknown) => { pushes++; smartUpdates.push({ layer, fid: index, params }); },
  };
  engine.onSync = null; // no document is open; the resync is not under test
  engine.engine = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => { destructive.push(prop); return 0; };
    },
    has() { return true; },
  }) as never;
}

function installHistoryEngine() {
  type Entry = { fid: number; params: number[] };
  let stack: Entry[] = [];
  const history: Entry[][] = [];
  let pushes = 0;
  const clone = (rows: Entry[]) => rows.map((row) => ({ fid: row.fid, params: [...row.params] }));
  const target: Record<string, unknown> = {
    layer_kind: () => LAYER_KIND.smartObject,
    smart_filter_id: (_layer: number, index: number) => stack[index]?.fid ?? -1,
    smart_add_filter: (_layer: number, fid: number, params: Float32Array) => {
      history.push(clone(stack)); pushes++;
      stack.push({ fid, params: Array.from(params) });
    },
    smart_update_filter: (_layer: number, index: number, params: Float32Array) => {
      if (!stack[index]) return;
      history.push(clone(stack)); pushes++;
      stack[index] = { fid: stack[index].fid, params: Array.from(params) };
    },
    undo: () => { const previous = history.pop(); if (previous) stack = previous; },
    undo_pushes: () => pushes,
    last_edit_error: () => "",
  };
  engine.onSync = null;
  engine.engine = new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => 0;
    },
  }) as never;
  return { stack: () => clone(stack), historyDepth: () => history.length };
}

/** Every action takes numbers, booleans or small vectors; ones is a valid value
 *  for all of them. Two take a structured argument, so they get theirs. */
const ARGS: Record<string, unknown[]> = {
  lightingEffects: [DEFAULT_LIGHTING],
  custom: [Array.from({ length: 25 }, () => 1), 1, 0],
  lensProfile: [[0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]],
};
const DEFAULT_ARGS = [1, 1, 1, 1, 1, 1, 1, 1];

function callAll(nsName: string, ns: object): { fids: number[]; silent: string[] } {
  const fids: number[] = [];
  const silent: string[] = [];
  for (const key of Object.keys(ns)) {
    const fn = (ns as Record<string, unknown>)[key];
    if (typeof fn !== "function") continue;
    const before = smartAdds.length;
    (fn as (...a: unknown[]) => unknown)(...(ARGS[key] ?? DEFAULT_ARGS));
    const added = smartAdds.slice(before);
    if (added.length !== 1) silent.push(`${nsName}.${key} pushed ${added.length} smart filters`);
    for (const call of added) fids.push(call.fid);
  }
  return { fids, silent };
}

beforeEach(() => { installEngine(LAYER_KIND.smartObject); });

describe("smart-filter fid wiring (VIS-LS-03)", () => {
  it("routes the audit's named repros (and one per family) onto the smart stack", () => {
    const cases: ReadonlyArray<readonly [string, () => void, number]> = [
      ["lensBlur", () => fil.lensBlur(8, 1), 18], // Filter ▸ Blur ▸ Lens Blur — the headline repro
      ["galleryBlur", () => fil.galleryBlur(0, 8, 0, 0, 0), 24], // Filter ▸ Blur Gallery
      ["posterEdges", () => fil.posterEdges(2, 1, 2), 36], // Filter Gallery family
      ["graphicPen", () => fil.graphicPen(15, 50, 0), 74], // Sketch family (fg/bg baked into params)
      ["radialBlur", () => distort.radialBlur(10, false, 0.5, 0.5), 92], // Filter ▸ Blur ▸ Radial Blur
      ["shadowsHighlights", () => adj.shadowsHighlights(35, 50, 0, 50), 101], // Image ▸ Adjustments
      ["surfaceBlur", () => fil.surfaceBlur(5, 15), 104], // direct-layer kernel lifted to a buf helper
      ["clouds", () => fil.clouds(), 112], // seeded render
    ];
    for (const [name, run, fid] of cases) {
      const before = smartAdds.length;
      run();
      const added = smartAdds.slice(before);
      expect(added.map((c) => c.fid), `${name} must ride smart fid ${fid}`).toEqual([fid]);
    }
    applyGalleryBlurPins(1, 12, Float32Array.of(10, 20, 1, 30, 0.5, 0, 1), 0.4, 0.2);
    applySpinBlurPins(35, 3, Float32Array.of(10, 20, 30, 24, 0, 0.25));
    expect(smartAdds.slice(-2).map(({ fid, params }) => [fid, Array.from(params as Float32Array)])).toEqual([
      [114, [1, 12, expect.closeTo(0.4), expect.closeTo(0.2), 10, 20, 1, 30, 0.5, 0, 1]],
      [115, [35, 3, 10, 20, 30, 24, 0, 0.25]],
    ]);
    // Nothing was baked into pixels while the smart object was active.
    expect(destructive.filter((m) => m.startsWith("filter_"))).toEqual([]);
  });

  it("gives every Filter-menu action its own smart fid — none is a silent no-op", () => {
    const filter = callAll("fil", fil);
    const warp = callAll("distort", distort);
    expect([...filter.silent, ...warp.silent]).toEqual([]);
    expect(filter.fids.length).toBeGreaterThan(90);
    // Params are baked at call time so a stack re-render replays identically.
    for (const call of smartAdds) expect(call.params).toBeInstanceOf(Float32Array);
  });

  it("uses every menu-owned fid exactly once", () => {
    for (const [name, ns] of [["fil", fil], ["distort", distort], ["neural", neural], ["adj", adj]] as const) {
      callAll(name, ns);
    }
    // Camera Raw develop rides fid 17 through smart_add_filter directly rather
    // than applyFilter, so it is driven on its own.
    adj.cameraRawDevelop(new Float32Array(8));

    const used = smartAdds.map((c) => c.fid).sort((a, b) => a - b);
    expect(new Set(used).size, "each fid owned by exactly one menu action").toBe(used.length);
    // The two pin-workspace actions are standalone so a composed workspace does
    // not masquerade as one proxied macro step, but they own the last two ids.
    applyGalleryBlurPins(1, 12, new Float32Array(), 0, 0);
    applySpinBlurPins(20, 0, new Float32Array());
    used.push(...smartAdds.slice(-2).map((c) => c.fid));
    used.sort((a, b) => a - b);
    // 0..17 are the original smart filters (17 = Camera Raw develop); 18..116
    // are the original Filter-menu parity range. 117 belongs to the separate
    // Liquify workspace; 118 adds calibrated Lens Correction.
    const expected = [
      ...Array(18).keys(),
      ...Array.from({ length: 99 }, (_, i) => 18 + i),
      118,
    ];
    expect(used).toEqual(expected);
  });

  it("re-edits only the captured pinned-blur row and rejects a stale fid", () => {
    expect(smart.updateFilter(0, 0, 115, Float32Array.of(20, 0))).toBe(false);
    expect(smartUpdates).toEqual([]);
    expect(smart.updateFilter(0, 0, 114, Float32Array.of(1, 12, 0, 0))).toBe(true);
    expect(smartUpdates).toEqual([{ layer: 0, fid: 0, params: expect.any(Float32Array) }]);
  });

  it("keeps Apply, re-edit Cancel, re-edit OK and Undo as reversible smart-filter history", () => {
    const h = installHistoryEngine();
    (store as unknown as { set(patch: unknown): void }).set({ activeLayerId: 0 });
    const original = Float32Array.of(1, 12, 0.2, 0.1, 10, 20, 1, 30, 0.5, 0, 1);
    applyGalleryBlurPins(1, 12, original.slice(4), 0.2, 0.1); // workspace Apply
    expect(h.stack()).toEqual([{ fid: 114, params: Array.from(original) }]);

    const cancelled = Float32Array.of(1, 25, 0.2, 0.1, ...original.slice(4));
    smart.updateFilter(0, 0, 114, cancelled); // live re-edit preview
    expect(h.stack()[0].params[1]).toBe(25);
    engine.e.undo(); engine.commit(); // Cancel rolls that preview back
    expect(h.stack()).toEqual([{ fid: 114, params: Array.from(original) }]);

    const committed = Float32Array.of(1, 40, 0.2, 0.1, ...original.slice(4));
    smart.updateFilter(0, 0, 114, committed); // queued preview
    engine.e.undo(); engine.commit(); // OK first removes the preview
    smart.updateFilter(0, 0, 114, committed); // then commits one real update
    expect(h.stack()[0].params[1]).toBe(40);
    engine.e.undo(); engine.commit();
    expect(h.stack()).toEqual([{ fid: 114, params: Array.from(original) }]);
    expect(h.historyDepth()).toBe(1); // only the original Apply remains undoable
  });

  it("bakes the filter into pixels when the layer is NOT a smart object", () => {
    installEngine(LAYER_KIND.pixel);
    fil.gaussian(4);
    expect(smartAdds).toEqual([]);
    expect(destructive).toContain("filter_gaussian_blur");
  });

  it("adds the smart filter to the layer the user selected", () => {
    (store as unknown as { set(patch: unknown): void }).set({ activeLayerId: 42 });
    fil.gaussian(4);
    expect(smartAdds).toEqual([expect.objectContaining({ layer: 42, fid: 0 })]);
    (store as unknown as { set(patch: unknown): void }).set({ activeLayerId: 0 });
  });

  // ── Cross-language guards (the engine is Rust; a node test cannot run it) ──

  it("every fid the app passes has a match arm in apply_smart_filter", () => {
    for (const [name, ns] of [["fil", fil], ["distort", distort], ["neural", neural], ["adj", adj]] as const) {
      callAll(name, ns);
    }
    adj.cameraRawDevelop(new Float32Array(8));
    applyGalleryBlurPins(1, 12, new Float32Array(), 0, 0);
    applySpinBlurPins(20, 0, new Float32Array());
    // The fid → kernel map: from `fn apply_smart_filter` up to the next top-level fn.
    const armSection = modSrc.slice(
      modSrc.indexOf("fn apply_smart_filter"),
      modSrc.indexOf("fn surface_blur_buf"),
    );
    for (const fid of new Set(smartAdds.map((c) => c.fid))) {
      expect(armSection, `engine arm for fid ${fid}`).toMatch(new RegExp(`^\\s+${fid} => `, "m"));
    }
    // The pin-placement arms are exercised by the standalone workspace actions.
    expect(armSection).toMatch(/^\s+114 => /m);
    expect(armSection).toMatch(/^\s+115 => /m);
  });

  it("the engine's destructive path refuses non-pixel layers loudly, not silently", () => {
    // apply16's old refusal was a bare `return` — the audit's silent no-op.
    expect(modSrc).toMatch(/fn refuse_destructive_edit\(&mut self\) -> bool/);
    expect(modSrc).toMatch(/if self\.refuse_destructive_edit\(\) \{\s*\n\s*return;/);
    expect(modSrc).toContain("self.last_edit_error = format!(\"Could not apply the edit because {reason}.\")");
  });
});
