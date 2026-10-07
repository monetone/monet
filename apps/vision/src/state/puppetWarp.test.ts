import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pinsMoved, puppetDestinations, vertexRest } from "./puppetWarp";

describe("puppetDestinations", () => {
  it("keeps a fixed pin and sends a dragged pin to the drag point", () => {
    const w = 80;
    const h = 40;
    const fixedV = 8;
    const dragV = 6;
    const fixed = vertexRest(fixedV, w, h);
    const rest = vertexRest(dragV, w, h);
    const { dx, dy } = puppetDestinations(w, h, [
      { v: fixedV, x: fixed.x, y: fixed.y },
      { v: dragV, x: rest.x + 10, y: rest.y },
    ]);
    expect(dx[fixedV]).toBeCloseTo(fixed.x);
    expect(dy[fixedV]).toBeCloseTo(fixed.y);
    expect(dx[dragV]).toBeCloseTo(rest.x + 10);
    expect(dy[dragV]).toBeCloseTo(rest.y);
    const loose = vertexRest(0, w, h);
    expect(dx[0]).not.toBeCloseTo(loose.x);
  });

  it("treats a pin that barely moved as identity", () => {
    const rest = vertexRest(6, 80, 40);
    expect(pinsMoved(80, 40, [{ v: 6, x: rest.x + 0.2, y: rest.y }])).toBe(false);
    expect(pinsMoved(80, 40, [{ v: 6, x: rest.x + 2, y: rest.y }])).toBe(true);
  });

  it("opens a session instead of the fixed bulge, and playback uses applyPuppetWarp", () => {
    const src = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
    const open = src.slice(src.indexOf("export function puppetWarp"), src.indexOf("export function applyPuppetWarp"));
    expect(open).toContain("openPuppetSession");
    expect(open).toContain("_unattended");
    expect(open).not.toContain("mesh_warp");
    const ops = src.slice(src.indexOf("function visionOps"), src.indexOf("export async function replayScriptOps"));
    expect(ops).not.toContain("puppetWarp:");
    expect(ops).toContain("applyPuppetWarp:");
  });
});
