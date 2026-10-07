import { describe, it, expect } from "vitest";
import {
  LIQUIFY_MESH_FORMAT,
  LIQUIFY_MESH_VERSION,
  MAX_LIQUIFY_MESH_DIMENSION,
  MAX_LIQUIFY_MESH_IMPORT_BYTES,
  MAX_LIQUIFY_MESH_POINTS,
  encodeLiquifyMesh,
  liquifyMeshDimensionsAllowed,
  parseLiquifyMesh,
} from "./liquifyMesh";

describe("Liquify mesh import/export", () => {
  it("round-trips dimensions and displacement fields", () => {
    const bytes = encodeLiquifyMesh({
      w: 2,
      h: 2,
      fx: new Float32Array([0, 1.25, -2.5, 3]),
      fy: new Float32Array([4, -5, 0.5, 6.75]),
    });
    expect(bytes).not.toBeNull();

    const parsed = parseLiquifyMesh(bytes!);
    expect(parsed?.w).toBe(2);
    expect(parsed?.h).toBe(2);
    expect(Array.from(parsed?.fx ?? [])).toEqual([0, 1.25, -2.5, 3]);
    expect(Array.from(parsed?.fy ?? [])).toEqual([4, -5, 0.5, 6.75]);
  });

  it("still loads a v1 number-array mesh file (#166)", () => {
    const v1 = JSON.stringify({
      format: LIQUIFY_MESH_FORMAT, version: 1, width: 2, height: 1, fx: [1.5, -2], fy: [0, 3.25],
    });
    const parsed = parseLiquifyMesh(v1);
    expect(Array.from(parsed?.fx ?? [])).toEqual([1.5, -2]);
    expect(Array.from(parsed?.fy ?? [])).toEqual([0, 3.25]);
  });

  it("writes a file its own importer accepts, whatever the warp (#166)", () => {
    const n = 64 * 64;
    const flat = encodeLiquifyMesh({ w: 64, h: 64, fx: new Float32Array(n), fy: new Float32Array(n) })!;
    const warped = new Float32Array(n).map((_, i) => Math.fround(Math.sin(i) * 17.3));
    const heavy = encodeLiquifyMesh({ w: 64, h: 64, fx: warped, fy: warped })!;
    // v1 serialised every f32 as its full-precision double ("1.7000000476837158"),
    // so a warped mesh was ~2.6× a flat one and could sail past the importer's
    // byte ceiling while an all-zero mesh of the same size fit.
    expect(heavy.length).toBe(flat.length);
    expect(Array.from(parseLiquifyMesh(heavy)?.fx ?? [])).toEqual(Array.from(warped)); // exact, not re-rounded
    // The encode ceiling can never exceed the parse ceiling again.
    expect(2 * Math.ceil((MAX_LIQUIFY_MESH_POINTS * 4) / 3) * 4).toBeLessThanOrEqual(MAX_LIQUIFY_MESH_IMPORT_BYTES);
  });

  it("exports a mesh for an ordinary photo-sized document (#165)", () => {
    expect(liquifyMeshDimensionsAllowed(3000, 2000)).toBe(true); // 6 MP
    expect(liquifyMeshDimensionsAllowed(4000, 3000)).toBe(true); // 12 MP
    // A real encode past the old 2048×2048 cap, which silently returned null.
    const w = 2049;
    const h = 2048;
    const bytes = encodeLiquifyMesh({ w, h, fx: new Float32Array(w * h), fy: new Float32Array(w * h) });
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBeLessThanOrEqual(MAX_LIQUIFY_MESH_IMPORT_BYTES);
  });

  it("rejects malformed metadata and array lengths", () => {
    expect(parseLiquifyMesh("{ nope")).toBeNull();
    expect(parseLiquifyMesh(JSON.stringify({ format: "other", version: LIQUIFY_MESH_VERSION, width: 1, height: 1, fx: [0], fy: [0] }))).toBeNull();
    expect(parseLiquifyMesh(JSON.stringify({ format: LIQUIFY_MESH_FORMAT, version: 99, width: 1, height: 1, fx: [0], fy: [0] }))).toBeNull();
    expect(parseLiquifyMesh(JSON.stringify({ format: LIQUIFY_MESH_FORMAT, version: LIQUIFY_MESH_VERSION, width: 2, height: 1, fx: [0], fy: [0, 0] }))).toBeNull();
  });

  it("rejects non-finite displacement values", () => {
    expect(parseLiquifyMesh(`{"format":"${LIQUIFY_MESH_FORMAT}","version":${LIQUIFY_MESH_VERSION},"width":1,"height":1,"fx":[1e999],"fy":[0]}`)).toBeNull();
  });

  it("does not encode invalid mesh shapes", () => {
    expect(encodeLiquifyMesh({ w: 2, h: 2, fx: new Float32Array(3), fy: new Float32Array(4) })).toBeNull();
    expect(encodeLiquifyMesh({ w: 0, h: 2, fx: new Float32Array(0), fy: new Float32Array(0) })).toBeNull();
    expect(encodeLiquifyMesh({ w: 1, h: 1, fx: new Float32Array([Infinity]), fy: new Float32Array([0]) })).toBeNull();
  });

  it("enforces byte, dimension, and point-count ceilings before allocating mesh arrays", () => {
    const square = Math.sqrt(MAX_LIQUIFY_MESH_POINTS);
    expect(Number.isInteger(square)).toBe(true);
    expect(liquifyMeshDimensionsAllowed(square, square)).toBe(true);
    expect(liquifyMeshDimensionsAllowed(square + 1, square)).toBe(false);
    expect(liquifyMeshDimensionsAllowed(MAX_LIQUIFY_MESH_DIMENSION + 1, 1)).toBe(false);

    const oversized = { length: MAX_LIQUIFY_MESH_IMPORT_BYTES + 1 } as unknown as Uint8Array;
    expect(parseLiquifyMesh(oversized)).toBeNull();
    expect(parseLiquifyMesh(JSON.stringify({
      format: LIQUIFY_MESH_FORMAT,
      version: LIQUIFY_MESH_VERSION,
      width: square + 1,
      height: square,
      fx: [],
      fy: [],
    }))).toBeNull();
  });
});
