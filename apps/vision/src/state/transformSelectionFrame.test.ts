// VIS-SEL-10 — Select ▸ Transform Selection: the live free-transform frame.
// Covers the pure frame geometry (scale / skew / rotate drags) and the mask
// warp that commits it, plus the store routing that keeps pure scale+move on
// the native engine path.
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import {
  Store, invertAffine, warpSelectionMask,
  scaleSelectionFrame, skewSelectionFrame, rotateSelectionFrame,
  selectionFrameHandles, selectionFrameQuad,
} from "./store";
import { pathTransformMatrix } from "./transformControls";

const BOX = { x: 0, y: 0, w: 100, h: 100 };
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);
const nearPt = (p: { x: number; y: number }, x: number, y: number, tol = 1e-6) => { near(p.x, x, tol); near(p.y, y, tol); };

describe("VIS-SEL-10 — Transform Selection frame geometry", () => {
  it("scaling a corner puts it under the pointer and pins the opposite corner", () => {
    // Handle 4 is BR (see transformHandles); its anchor is TL at (0, 0).
    const t = scaleSelectionFrame(BOX, {}, 4, { x: 150, y: 150 });
    near(t.sx!, 1.5);
    near(t.sy!, 1.5);
    const h = selectionFrameHandles(BOX, t);
    nearPt(h[0], 0, 0);       // TL held
    nearPt(h[4], 150, 150);   // BR follows the pointer
  });

  it("an edge midpoint scales only its own axis", () => {
    const t = scaleSelectionFrame(BOX, {}, 3, { x: 250, y: 999 }); // R handle
    near(t.sx!, 2.5);
    near(t.sy!, 1);
    const h = selectionFrameHandles(BOX, t);
    nearPt(h[7], 0, 50);      // L midpoint held
    nearPt(h[3], 250, 50);    // R midpoint follows x only
  });

  it("Shift locks the aspect ratio to whichever axis was pulled hardest", () => {
    const t = scaleSelectionFrame(BOX, {}, 4, { x: 300, y: 120 }, true);
    near(t.sx!, 3);
    near(t.sy!, 3);
  });

  it("scaling still tracks the pointer on an already-rotated frame", () => {
    const t0 = { deg: 90 };
    // Rotated 90° about the centre, the BR handle now sits where BL was.
    const before = selectionFrameHandles(BOX, t0);
    const t = scaleSelectionFrame(BOX, t0, 4, { x: -50, y: 150 });
    const after = selectionFrameHandles(BOX, t);
    nearPt(after[0], before[0].x, before[0].y, 1e-5); // TL (the anchor) unmoved
    nearPt(after[4], -50, 150, 1e-5);                 // BR under the pointer
  });

  it("rotating measures the angle about the frame centre and Shift snaps to 15°", () => {
    const t = rotateSelectionFrame(BOX, {}, { x: 150, y: 50 }, { x: 50, y: 150 });
    near(t.deg!, 90);
    // 40° of drag snaps back to 45°.
    const snapped = rotateSelectionFrame(BOX, {}, { x: 150, y: 50 }, { x: 50 + Math.cos(40 * Math.PI / 180) * 100, y: 50 + Math.sin(40 * Math.PI / 180) * 100 }, true);
    near(snapped.deg!, 45, 1e-9);
  });

  it("skewing an edge midpoint shears along that edge and pins the far edge", () => {
    const t = skewSelectionFrame(BOX, {}, 1, { x: 100, y: 0 }); // drag T midpoint right by 50
    near(t.skewH!, (Math.atan(-0.5) * 180) / Math.PI); // top edge slides +x → negative shear term
    const h = selectionFrameHandles(BOX, t);
    nearPt(h[5], 50, 100);   // bottom midpoint held
    near(h[1].x, 100);       // top midpoint under the pointer
    near(h[1].y, 0);
  });

  it("corners do not skew — a distort needs a homography, not an affine", () => {
    expect(skewSelectionFrame(BOX, { sx: 2 }, 4, { x: 400, y: 400 })).toEqual({ sx: 2 });
  });

  it("the quad is the box run through its affine", () => {
    const q = selectionFrameQuad(BOX, { deg: 90 });
    nearPt(q[0], 100, 0, 1e-9); // TL rotates to the top-right
    nearPt(q[2], 0, 100, 1e-9);
  });
});

describe("VIS-SEL-10 — selection mask warp", () => {
  const W = 8, H = 8;
  // A 4×2 block at (2,2): wide enough that a 90° turn is visibly different.
  const rect = () => {
    const m = new Uint8Array(W * H);
    for (let y = 2; y < 4; y++) for (let x = 2; x < 6; x++) m[y * W + x] = 255;
    return m;
  };
  const bounds = (m: Uint8Array) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x] > 127) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  };

  it("is exact for the identity", () => {
    const m = rect();
    expect(Array.from(warpSelectionMask(m, W, H, pathTransformMatrix({}, 4, 3)))).toEqual(Array.from(m));
  });

  it("rotates the marquee 90°, swapping its extents", () => {
    const m = rect();
    // Selection bbox is [2,2,4,2] → centre (4, 3).
    const out = warpSelectionMask(m, W, H, pathTransformMatrix({ deg: 90 }, 4, 3));
    expect(bounds(out)).toEqual([3, 1, 2, 4]);
  });

  it("moves whole pixels without softening the edge", () => {
    const out = warpSelectionMask(rect(), W, H, pathTransformMatrix({ tx: 1, ty: 1 }, 4, 3));
    expect(bounds(out)).toEqual([3, 3, 4, 2]);
    expect(new Set(out)).toEqual(new Set([0, 255])); // still binary — no bilinear smear
  });

  it("returns an empty mask for a collapsed frame rather than garbage", () => {
    expect(invertAffine([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(warpSelectionMask(rect(), W, H, [0, 0, 0, 0, 0, 0]).some((v) => v !== 0)).toBe(false);
  });
});

describe("VIS-SEL-10 — store routing", () => {
  function makeStore(hasSel = true) {
    const calls: unknown[][] = [];
    const e = {
      has_selection: () => hasSel,
      selection_bounds: () => [1, 1, 2, 2],
      transform_selection: vi.fn<(...a: unknown[]) => void>((...a) => { calls.push(["native", ...a]); }),
      transform_selection_affine: vi.fn<(...a: unknown[]) => void>((...a) => { calls.push(["affine", ...a]); }),
    };
    const client = { engine: e, e, sync: vi.fn(), onCommit: null };
    const store = new Store(client as never);
    (store as unknown as { snap: { doc: { width: number; height: number } } }).snap.doc = { width: 4, height: 4 };
    return { store, e, calls };
  }

  it("keeps pure scale + move on the native engine path", () => {
    const { store, e } = makeStore();
    store.transformSelection(0.5, 0.5, 3, -2);
    expect(e.transform_selection.mock.calls[0]).toEqual([0.5, 0.5, 3, -2]);
    expect(e.transform_selection_affine).not.toHaveBeenCalled();
  });

  it("routes rotation or skew through the native affine engine path", () => {
    const { store, e } = makeStore();
    store.transformSelection(1, 1, 0, 0, 90);
    expect(e.transform_selection).not.toHaveBeenCalled();
    expect(e.transform_selection_affine.mock.calls[0]).toHaveLength(6);
    expect(e.transform_selection_affine.mock.calls[0].every((v: unknown) => typeof v === "number")).toBe(true);
  });

  it("clamps skew to ±89° — tan(90°) would fold the frame to zero area", () => {
    // 89°, 90° and 120° must all land on the same clamped shear, and a NaN
    // angle must not reach the warp at all.
    const at = (deg: number) => {
      const { store, e } = makeStore();
      store.transformSelection(1, 1, 0, 0, 0, deg, 0);
      return e.transform_selection_affine.mock.calls[0];
    };
    expect(at(90)).toEqual(at(89));
    expect(at(120)).toEqual(at(89));
    // A NaN angle sanitizes to 0, which leaves an all-identity transform —
    // that touches neither path, so it cannot push an undo step for nothing.
    const { store, e } = makeStore();
    store.transformSelection(1, 1, 0, 0, 0, Number.NaN, 0);
    expect(e.transform_selection_affine).not.toHaveBeenCalled();
    expect(e.transform_selection).not.toHaveBeenCalled();
    // A sanitized angle that still moves the frame does reach the warp.
    store.transformSelection(1, 1, 0, 0, Number.NaN, 45, 0);
    expect(e.transform_selection_affine).toHaveBeenCalled();
  });

  it("opens, updates and commits an on-canvas frame without touching pixels", () => {
    const { store, e } = makeStore();
    expect(store.beginSelectionTransform()).toBe(true);
    expect(store.state.selectionTransform?.box).toEqual({ x: 1, y: 1, w: 2, h: 2 });
    store.updateSelectionTransform({ deg: 45 });
    expect(store.state.selectionTransform?.t.deg).toBe(45);
    store.commitSelectionTransform();
    expect(store.state.selectionTransform).toBeNull();
    expect(e.transform_selection_affine).toHaveBeenCalledTimes(1);
  });

  it("cancelling leaves the marquee untouched, and an identity commit is not an undo step", () => {
    const { store, e } = makeStore();
    store.beginSelectionTransform({ deg: 30 });
    store.cancelSelectionTransform();
    expect(store.state.selectionTransform).toBeNull();
    expect(e.transform_selection_affine).not.toHaveBeenCalled();

    store.beginSelectionTransform();
    store.commitSelectionTransform();
    expect(e.transform_selection_affine).not.toHaveBeenCalled();
    expect(e.transform_selection).not.toHaveBeenCalled();
  });

  it("refuses to open a frame with no selection", () => {
    const { store } = makeStore(false);
    expect(store.beginSelectionTransform()).toBe(false);
    expect(store.state.selectionTransform).toBeNull();
  });
});
