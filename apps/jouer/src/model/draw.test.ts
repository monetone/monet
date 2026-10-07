import { describe, expect, it } from "vitest";
import { DEFAULT_DRAW_SIZE, drawSize, isSliced, isTiled, sliceBorders } from "./draw";
import { createGameObject, createProject, createScene } from "./factory";
import { projectFromJson, projectToJson } from "../io/jouer";
import { exportTweenProp } from "../io/export-phaser";
import { activeScene, findObject } from "./query";

// Unity-parity SpriteRenderer Draw Mode (Simple / Tiled / Sliced): only
// sprites/images draw non-simply; the flag is a no-op on every other kind.
// isTiled/isSliced/drawSize/sliceBorders are the single source the editor
// runtime, the player and the exporter branch on.
describe("isTiled", () => {
  it("is true for a sprite with drawMode 'tiled'", () => {
    expect(isTiled(createGameObject("sprite", { drawMode: "tiled" }))).toBe(true);
  });

  it("is true for an image with drawMode 'tiled'", () => {
    expect(isTiled(createGameObject("image", { drawMode: "tiled" }))).toBe(true);
  });

  it("is false for a sprite left at the default (simple) draw mode", () => {
    expect(isTiled(createGameObject("sprite"))).toBe(false);
  });

  it("ignores the flag on non-textured kinds", () => {
    // A shape can never carry a meaningful drawMode even if one is forced on.
    const rect = { ...createGameObject("rectangle"), drawMode: "tiled" as const };
    expect(isTiled(rect)).toBe(false);
  });
});

describe("isSliced", () => {
  it("is true for a sprite/image with drawMode 'sliced'", () => {
    expect(isSliced(createGameObject("sprite", { drawMode: "sliced" }))).toBe(true);
    expect(isSliced(createGameObject("image", { drawMode: "sliced" }))).toBe(true);
  });

  it("is false for simple/tiled sprites and for non-textured kinds", () => {
    expect(isSliced(createGameObject("sprite"))).toBe(false);
    expect(isSliced(createGameObject("sprite", { drawMode: "tiled" }))).toBe(false);
    expect(isSliced({ ...createGameObject("rectangle"), drawMode: "sliced" as const })).toBe(false);
  });
});

describe("drawSize (shared by tiled + sliced)", () => {
  it("defaults both dimensions when width/height are unset", () => {
    expect(drawSize(createGameObject("sprite", { drawMode: "tiled" }))).toEqual({
      width: DEFAULT_DRAW_SIZE, height: DEFAULT_DRAW_SIZE,
    });
  });

  it("uses the explicit width/height when present", () => {
    expect(drawSize(createGameObject("sprite", { drawMode: "sliced", width: 64, height: 48 }))).toEqual({
      width: 64, height: 48,
    });
  });
});

describe("sliceBorders", () => {
  it("defaults every inset to 0", () => {
    expect(sliceBorders(createGameObject("sprite", { drawMode: "sliced" }))).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("returns the set insets and clamps negatives to 0", () => {
    const o = createGameObject("sprite", { drawMode: "sliced", sliceLeft: 8, sliceRight: 12, sliceTop: 4, sliceBottom: -5 });
    expect(sliceBorders(o)).toEqual({ left: 8, right: 12, top: 4, bottom: 0 });
  });
});

describe("drawMode .jouer round-trip", () => {
  it("preserves a tiled sprite's drawMode + tile size", () => {
    const sprite = createGameObject("sprite", { id: "s1", drawMode: "tiled", width: 64, height: 48 });
    const project = createProject("P", { scenes: [createScene("S", { objects: [sprite] })] });
    const back = projectFromJson(projectToJson(project));
    const o = findObject(activeScene(back), "s1");
    expect(o).toMatchObject({ drawMode: "tiled", width: 64, height: 48 });
  });

  it("preserves a sliced sprite's drawMode + borders", () => {
    const sprite = createGameObject("sprite", { id: "s2", drawMode: "sliced", width: 80, height: 80, sliceLeft: 8, sliceRight: 8, sliceTop: 12, sliceBottom: 4 });
    const project = createProject("P", { scenes: [createScene("S", { objects: [sprite] })] });
    const back = projectFromJson(projectToJson(project));
    const o = findObject(activeScene(back), "s2");
    expect(o).toMatchObject({ drawMode: "sliced", width: 80, height: 80, sliceLeft: 8, sliceRight: 8, sliceTop: 12, sliceBottom: 4 });
  });

  it("defaults a textured object with no drawMode key to 'simple'", () => {
    const partial = {
      schema: "monet-jouer/v1", name: "P", activeSceneId: "s1",
      scenes: [{ id: "s1", name: "S", objects: [{ id: "im", kind: "image", name: "I", assetId: "a1" }] }],
    };
    const back = projectFromJson(JSON.stringify(partial));
    expect(findObject(activeScene(back), "im")?.drawMode).toBe("simple");
  });
});

// A tiled sprite owns its size via its tiled area (width/height); a simple one
// scales the texture (displayWidth/displayHeight). Animating size must target the
// right Phaser property so editor/player/export agree and the tile isn't distorted.
describe("exportTweenProp draw-mode mapping", () => {
  it("maps width/height to displayWidth/displayHeight for a simple sprite", () => {
    const o = createGameObject("sprite");
    expect(exportTweenProp("width", o)).toBe("displayWidth");
    expect(exportTweenProp("height", o)).toBe("displayHeight");
  });

  it("maps width/height to the node's own width/height for a tiled or sliced sprite", () => {
    const tiled = createGameObject("sprite", { drawMode: "tiled", width: 64, height: 64 });
    expect(exportTweenProp("width", tiled)).toBe("width");
    expect(exportTweenProp("height", tiled)).toBe("height");
    const sliced = createGameObject("image", { drawMode: "sliced", width: 64, height: 64 });
    expect(exportTweenProp("width", sliced)).toBe("width");
    expect(exportTweenProp("height", sliced)).toBe("height");
  });

  it("leaves non-textured kinds editor-only (null) regardless of draw mode", () => {
    expect(exportTweenProp("width", createGameObject("rectangle"))).toBeNull();
  });
});
