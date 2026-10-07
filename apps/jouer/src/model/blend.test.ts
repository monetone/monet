import { describe, expect, it } from "vitest";
import { BLEND_MODES, isNormalBlend, phaserBlendName } from "./blend";
import { createGameObject, createProject, createScene } from "./factory";
import { projectFromJson, projectToJson } from "../io/jouer";
import { activeScene, findObject } from "./query";

// Unity-parity render blend mode (SpriteRenderer material blend, 2D subset).
// phaserBlendName is the single source the editor runtime, the player and the
// exporter map the model mode through.
describe("phaserBlendName", () => {
  it("maps each mode to its Phaser BlendModes key", () => {
    expect(phaserBlendName("normal")).toBe("NORMAL");
    expect(phaserBlendName("add")).toBe("ADD");
    expect(phaserBlendName("multiply")).toBe("MULTIPLY");
    expect(phaserBlendName("screen")).toBe("SCREEN");
  });

  it("defaults to NORMAL for undefined or an unknown value", () => {
    expect(phaserBlendName(undefined)).toBe("NORMAL");
    expect(phaserBlendName("bogus" as never)).toBe("NORMAL");
  });
});

describe("isNormalBlend", () => {
  it("is true for undefined and 'normal', false otherwise", () => {
    expect(isNormalBlend(undefined)).toBe(true);
    expect(isNormalBlend("normal")).toBe(true);
    expect(isNormalBlend("add")).toBe(false);
    expect(isNormalBlend("screen")).toBe(false);
  });
});

describe("BLEND_MODES", () => {
  it("lists the four supported modes", () => {
    expect(BLEND_MODES).toEqual(["normal", "add", "multiply", "screen"]);
  });
});

describe("blendMode .jouer round-trip", () => {
  it("preserves a non-normal blend mode", () => {
    const o = createGameObject("rectangle", { id: "r1", blendMode: "add" });
    const project = createProject("P", { scenes: [createScene("S", { objects: [o] })] });
    const back = projectFromJson(projectToJson(project));
    expect(findObject(activeScene(back), "r1")?.blendMode).toBe("add");
  });

  it("drops 'normal' (stays blend-free) on round-trip", () => {
    const o = createGameObject("rectangle", { id: "r2", blendMode: "normal" });
    const project = createProject("P", { scenes: [createScene("S", { objects: [o] })] });
    const back = projectFromJson(projectToJson(project));
    expect(findObject(activeScene(back), "r2")?.blendMode).toBeUndefined();
  });
});
