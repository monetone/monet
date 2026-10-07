import { describe, it, expect } from "vitest";
import {
  BLUR_TOOLS, BLUR_TOOL_FOR_DIALOG, GALLERY_PINS_FID, PATH_TOOL, SPIN_PINS_FID,
  blurGallerySteps, defaultBlurGalleryState, pinnedBlurSmartFilter, pinnedBlurState, pinsOfKind,
  type BlurGalleryState, type GalleryPin,
} from "./blurGallery";
import { defaultPin, type PinKind } from "./blurPins";

const pin = (kind: PinKind, x = 100, y = 80): GalleryPin => ({ kind, ...defaultPin(kind, 400, 300, x, y) });

// A workspace with the given pins and nothing else switched on.
const withPins = (pins: GalleryPin[]): BlurGalleryState =>
  ({ ...defaultBlurGalleryState(0, 400, 300), pins });
const NOISE_SEED = 0x1234_5678;
const steps = (state: BlurGalleryState) => blurGallerySteps(state, NOISE_SEED);

describe("Blur Gallery workspace", () => {
  it("opens the same workspace from all five menu items, on the tool they name", () => {
    expect(Object.keys(BLUR_TOOL_FOR_DIALOG).sort()).toEqual(
      ["fieldBlur", "irisBlur", "pathBlur", "spinBlur", "tiltShift"]);
    // Every menu item maps to a tool the rail actually offers.
    const rail = BLUR_TOOLS.map((t) => t.tool);
    for (const tool of Object.values(BLUR_TOOL_FOR_DIALOG)) expect(rail).toContain(tool);
    // A pin tool seeds one pin of its own kind; Path seeds none but arrives on.
    expect(defaultBlurGalleryState(BLUR_TOOL_FOR_DIALOG.tiltShift, 400, 300).pins.map((p) => p.kind)).toEqual([2]);
    const path = defaultBlurGalleryState(BLUR_TOOL_FOR_DIALOG.pathBlur, 400, 300);
    expect(path.pins).toEqual([]);
    expect(path.pathOn).toBe(true);
    expect(defaultBlurGalleryState(BLUR_TOOL_FOR_DIALOG.irisBlur, 400, 300).pathOn).toBe(false);
  });

  it("stacks every tool in one pass, in rail order with the noise grain last", () => {
    const composed = steps({
      ...withPins([pin(3), pin(1), pin(0), pin(2), pin(1, 50, 50)]),
      pathOn: true, pathSpeed: 40, noise: 12,
    });
    expect(composed.map((s) => s.op)).toEqual(["gallery", "gallery", "gallery", "path", "spin", "noise"]);
    expect(composed.filter((s) => s.op === "gallery").map((s) => s.kind)).toEqual([0, 1, 2]);
  });

  it("applies nothing when no tool is placed", () => {
    expect(steps(withPins([]))).toEqual([]);
  });

  it("emits one gallery step per kind, carrying only that kind's pins", () => {
    const composed = steps(withPins([pin(1, 10, 10), pin(0), pin(1, 200, 40)]));
    expect(composed).toHaveLength(2);
    const iris = composed.find((s) => s.op === "gallery" && s.kind === 1);
    expect(iris?.op === "gallery" && iris.pins.length).toBe(2 * 7); // GALLERY_PIN_STRIDE
    expect(iris?.op === "gallery" && [iris.pins[0], iris.pins[1]]).toEqual([10, 10]);
    const field = composed.find((s) => s.op === "gallery" && s.kind === 0);
    expect(field?.op === "gallery" && field.pins.length).toBe(1 * 7);
  });

  it("keeps spin pins on the 6-float spin ABI, not the 7-float gallery one", () => {
    const [step] = steps({ ...withPins([pin(3), pin(3, 20, 20)]), spinAngle: 30, strobe: 4 });
    expect(step.op).toBe("spin");
    expect(step.op === "spin" && step.pins.length).toBe(2 * 6);
    expect(step.op === "spin" && [step.angle, step.strobe]).toEqual([30, 4]);
  });

  it("round-trips pinned Gallery and Spin rows through their smart-filter ABIs", () => {
    const iris = {
      ...withPins([{ ...pin(1, 23, 41), focus: 36, feather: 0.4, rotation: 45, aspect: 0.75 }]),
      radius: 18, bokeh: 35, bokehColor: 20,
    };
    const gallery = pinnedBlurSmartFilter(iris, 1);
    expect(gallery.fid).toBe(GALLERY_PINS_FID);
    expect(Array.from(gallery.params.slice(0, 4))).toEqual([1, 18, expect.closeTo(0.35), expect.closeTo(0.2)]);
    const restoredGallery = pinnedBlurState(gallery.fid, Array.from(gallery.params), 400, 300)!;
    expect(restoredGallery.tool).toBe(1);
    expect(restoredGallery.state).toMatchObject({ radius: 18, bokeh: expect.closeTo(35), bokehColor: expect.closeTo(20) });
    expect(restoredGallery.state.pins[0]).toMatchObject({
      kind: 1, x: 23, y: 41, focus: 36, feather: expect.closeTo(0.4),
      rotation: expect.closeTo(45), aspect: 0.75,
    });

    const spin = {
      ...withPins([{ ...pin(3, 90, 70), focus: 50, aspect: 0.6, rotation: -30, feather: 0.2 }]),
      spinAngle: 42, strobe: 5,
    };
    const packedSpin = pinnedBlurSmartFilter(spin, 3);
    expect(packedSpin.fid).toBe(SPIN_PINS_FID);
    const restoredSpin = pinnedBlurState(packedSpin.fid, Array.from(packedSpin.params), 400, 300)!;
    expect(restoredSpin.state).toMatchObject({ spinAngle: 42, strobe: 5 });
    expect(restoredSpin.state.pins[0]).toMatchObject({
      kind: 3, x: 90, y: 70, focus: 50, aspect: expect.closeTo(0.6),
      rotation: expect.closeTo(-30), feather: expect.closeTo(0.2),
    });
  });

  it("rejects malformed pinned smart-filter payloads instead of opening them as editable pins", () => {
    expect(pinnedBlurState(GALLERY_PINS_FID, [9, 15, 0, 0], 400, 300)).toBeNull();
    expect(pinnedBlurState(GALLERY_PINS_FID, [1, 15, 0, 0, 10], 400, 300)).toBeNull();
    expect(pinnedBlurState(SPIN_PINS_FID, [15, 0, Number.NaN], 400, 300)).toBeNull();
  });

  it("skips Path Blur unless it is switched on and actually moves", () => {
    const base = { ...withPins([]), pathOn: true, pathSpeed: 0 };
    expect(steps(base)).toEqual([]);
    expect(steps({ ...base, pathSpeed: 12 }).map((s) => s.op)).toEqual(["path"]);
    expect(steps({ ...base, pathOn: false, pathSpeed: 12 })).toEqual([]);
  });

  it("scales the percent-valued UI fields into the engine's 0..1 params", () => {
    const [gallery] = steps({ ...withPins([pin(0)]), bokeh: 40, bokehColor: 25 });
    expect(gallery.op === "gallery" && [gallery.bokeh, gallery.bokehColor]).toEqual([0.4, 0.25]);
    const [path] = steps({ ...withPins([]), pathOn: true, pathSpeed: 8, pathTaper: 60 });
    expect(path.op === "path" && path.taper).toBeCloseTo(0.6);
    const [noise] = steps({ ...withPins([]), noise: 12, noiseMono: true });
    expect(noise.op === "noise" && [noise.amount, noise.mono, noise.seed]).toEqual([0.12, true, NOISE_SEED]);
    expect(steps({ ...withPins([]), noise: 0 })).toEqual([]);
  });

  it("pins one normalized u32 noise seed into every recomposed preview", () => {
    const state = { ...withPins([]), noise: 12 };
    expect(blurGallerySteps(state, -1)).toEqual(blurGallerySteps(state, 0xffff_ffff));
    expect((blurGallerySteps(state, 7)[0] as { seed: number }).seed).toBe(7);
  });

  it("partitions pins by kind without dropping any", () => {
    const pins = [pin(0), pin(2), pin(0, 5, 5), pin(3)];
    expect(pinsOfKind(pins, 0)).toHaveLength(2);
    expect(pinsOfKind(pins, 1)).toHaveLength(0);
    expect(([0, 1, 2, 3] as PinKind[]).reduce<number>((n, k) => n + pinsOfKind(pins, k).length, 0)).toBe(pins.length);
  });

  it("lists Path between Tilt-Shift and Spin, the way Photoshop's rail does", () => {
    expect(BLUR_TOOLS.map((t) => t.tool)).toEqual([0, 1, 2, PATH_TOOL, 3]);
  });
});
