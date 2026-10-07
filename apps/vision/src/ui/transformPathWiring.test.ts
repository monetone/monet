// Photoshop retargets Edit ▸ Free Transform / Transform onto the Pen work path
// when a path tool holds one ("Free Transform Path" / "Transform Path").
//
// The decision every one of those menu items branches on — and the store call
// the dialog's OK button makes, including the false return its toast depends on
// — is exercised for real below. The dialog's own field-to-argument mapping
// stays source-pinned; see the residual guard at the bottom for why. The
// transform geometry itself is covered by ../state/transformPath.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { PATH_TOOLS, Store } from "../state/store";
import { pathBounds } from "../state/transformControls";
import type { DialogName } from "./dialogs/common";

// A 20×10 rectangle at (10, 10) — asymmetric, so a scale is unambiguous.
const RECT = [10, 10, 30, 10, 30, 20, 10, 20];

function storeWith() {
  // No wasm: the work path is pure state, and setTool needs nothing else.
  const client = { engine: undefined, e: { set_mask_reveal: vi.fn() }, commit: vi.fn(() => true), onCommit: null };
  return new Store(client as never);
}

describe("Transform Path retargeting", () => {
  it("registers transformPath on the DialogName union", () => {
    // Compile-checked: an unregistered name fails `pnpm typecheck`, which is
    // what the old regex over common.tsx was standing in for.
    const name: DialogName = "transformPath";
    expect(name).toBe("transformPath");
  });

  it("targets the path for every path tool, and never for a pixel tool", () => {
    const store = storeWith();
    store.setPenPath(RECT);
    for (const tool of PATH_TOOLS) {
      store.setTool(tool);
      expect(store.pathIsTransformTarget(), `${tool} holds the work path`).toBe(true);
    }
    for (const tool of ["move", "brush", "crop", "marquee"] as const) {
      store.setTool(tool);
      expect(store.pathIsTransformTarget(), `${tool} must fall through to the layer transform`).toBe(false);
    }
  });

  it("falls back to the layer transform when a path tool holds no path", () => {
    const store = storeWith();
    store.setTool("pen");
    expect(store.pathIsTransformTarget()).toBe(false);
  });

  it("returns false when there is nothing to transform, so OK cannot be a silent no-op", () => {
    // TransformPath toasts on this exact `false` — a swallowed return would make
    // the dialog close having done nothing, with no explanation.
    const store = storeWith();
    expect(store.transformWorkPath({ sx: 2, sy: 2, deg: 0, skewH: 0, skewV: 0, tx: 0, ty: 0 })).toBe(false);
  });

  it("reads the dialog's percentages as scale factors about the path's centre", () => {
    // The dialog's Width/Height fields are percentages (w / 100 → sx), so 200%
    // has to double the bounding box in place.
    const store = storeWith();
    store.setPenPath(RECT);
    const [w, h] = [200, 200];
    expect(store.transformWorkPath({ sx: w / 100, sy: h / 100, deg: 0, skewH: 0, skewV: 0, tx: 0, ty: 0 })).toBe(true);
    expect(pathBounds(store.state.penPath)).toEqual({ x: 0, y: 5, w: 40, h: 20 });
  });

  it("moves by whole pixels and replays the last transform for Transform ▸ Again", () => {
    const store = storeWith();
    store.setTool("pen");
    store.setPenPath(RECT);
    expect(store.transformWorkPath({ sx: 1, sy: 1, deg: 0, skewH: 0, skewV: 0, tx: Math.round(7.4), ty: Math.round(-3.6) })).toBe(true);
    expect(pathBounds(store.state.penPath)).toEqual({ x: 17, y: 6, w: 20, h: 10 });
    expect(store.repeatWorkPathTransform()).toBe(true);
    expect(pathBounds(store.state.penPath)).toEqual({ x: 24, y: 2, w: 20, h: 10 });
  });
});

// ── residual source-level guard ────────────────────────────────
// TransformPath is module-private in Dialogs.tsx (only DialogHost's switch
// reaches it) and App.tsx builds its shortcut map inside the App component over
// the live engine/canvas — neither is importable or mountable in the Node unit
// run, and both files are excluded from its coverage. Pinning the call sites is
// the only check available below the e2e suite; the store contract they rest on
// is covered above.
const dialogsSource = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");
const appSource = readFileSync(fileURLToPath(new URL("../App.tsx", import.meta.url)), "utf8");

function section(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

describe("Transform Path dialog call sites", () => {
  it("routes the numeric fields through store.transformWorkPath and surfaces a no-op", () => {
    const body = section(dialogsSource, "function TransformPath()", "function WarpDialog()");
    expect(body).toContain("store.transformWorkPath({ sx: w / 100, sy: h / 100, deg: angle, skewH, skewV, tx: Math.round(tx), ty: Math.round(ty) })");
    expect(body).toContain("if (!ok) toast.push(");
  });

  it("wires the dialog into the open() switch", () => {
    expect(dialogsSource).toContain('case "transformPath": return <TransformPath />;');
  });

  it("retargets Free Transform / Scale / Rotate / Skew onto the path when a path tool holds one", () => {
    const shortcuts = section(appSource, "freexf: () => open(", "colordecontaminate: () => open(\"defringe\")");
    expect(shortcuts).toContain('freexf: () => open(store.pathIsTransformTarget() ? "transformPath" : "freeTransform"),');
    expect(shortcuts).toContain('xfscale: () => store.pathIsTransformTarget() ? open("transformPath", "scale") : open("freeTransform", "scale"),');
    expect(shortcuts).toContain('xfrotate: () => store.pathIsTransformTarget() ? open("transformPath", "rotate") : open("freeTransform", "rotate"),');
    expect(shortcuts).toContain('skew: () => store.pathIsTransformTarget() ? open("transformPath", "skew") : open("skew"),');
  });
});
