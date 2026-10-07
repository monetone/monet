import { describe, expect, it } from "vitest";
import { textShadowConfig } from "./text";
import { createGameObject, createProject, createScene, defaultTextStyle } from "./factory";
import { projectFromJson, projectToJson } from "../io/jouer";
import { activeScene, findObject } from "./query";

// Unity-parity Text drop shadow (UI "Shadow" component): a shadow renders only
// when it has a visible offset or blur. textShadowConfig is the single source the
// editor runtime, the player and the exporter share, so the live editor, the
// played game and the exported code stay identical.
describe("textShadowConfig", () => {
  it("returns null for the default style (no offset, no blur)", () => {
    expect(textShadowConfig(defaultTextStyle())).toBeNull();
  });

  it("returns null when given no style", () => {
    expect(textShadowConfig(undefined)).toBeNull();
  });

  it("returns null when color is set but the shadow has no offset or blur", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowColor: "#ff0000" }))).toBeNull();
  });

  it("activates on a non-zero X offset", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowOffsetX: 2, shadowColor: "#112233" }))).toEqual({
      offsetX: 2, offsetY: 0, color: "#112233", blur: 0, fill: true, stroke: false,
    });
  });

  it("activates on a non-zero Y offset (incl. negative)", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowOffsetY: -3 }))).toEqual({
      offsetX: 0, offsetY: -3, color: "#000000", blur: 0, fill: true, stroke: false,
    });
  });

  it("activates on blur alone (a glow with no offset)", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowBlur: 4 }))).toEqual({
      offsetX: 0, offsetY: 0, color: "#000000", blur: 4, fill: true, stroke: false,
    });
  });

  it("clamps a negative blur to 0 and stays inactive when nothing else is set", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowBlur: -5 }))).toBeNull();
  });

  it("clamps a negative blur to 0 when an offset keeps it active", () => {
    expect(textShadowConfig(defaultTextStyle({ shadowOffsetX: 1, shadowBlur: -5 }))).toEqual({
      offsetX: 1, offsetY: 0, color: "#000000", blur: 0, fill: true, stroke: false,
    });
  });
});

describe("text shadow .jouer round-trip", () => {
  it("preserves the shadow fields through serialize → deserialize", () => {
    const text = createGameObject("text", {
      id: "t1",
      style: defaultTextStyle({ shadowColor: "#ff8800", shadowOffsetX: 4, shadowOffsetY: -2, shadowBlur: 3 }),
    });
    const project = createProject("P", { scenes: [createScene("S", { objects: [text] })] });
    const back = projectFromJson(projectToJson(project));
    const o = findObject(activeScene(back), "t1");
    expect(o?.style).toMatchObject({ shadowColor: "#ff8800", shadowOffsetX: 4, shadowOffsetY: -2, shadowBlur: 3 });
  });

  it("defaults the shadow fields when a document omits them", () => {
    // A partial .jouer file: a text object whose style has no shadow keys.
    const partial = {
      schema: "monet-jouer/v1", name: "P",
      activeSceneId: "s1",
      scenes: [{
        id: "s1", name: "S", objects: [{
          id: "t1", kind: "text", name: "T", text: "hi",
          style: { fontFamily: "Arial", fontSize: 32, color: "#fff", fontStyle: "normal", align: "left" },
        }],
      }],
    };
    const back = projectFromJson(JSON.stringify(partial));
    const o = findObject(activeScene(back), "t1");
    expect(o?.style).toMatchObject({ shadowColor: "#000000", shadowOffsetX: 0, shadowOffsetY: 0, shadowBlur: 0 });
  });
});

// Unity TMP "Character Spacing": extra px between glyphs (may be negative).
describe("text letterSpacing", () => {
  it("defaults to 0", () => {
    expect(defaultTextStyle().letterSpacing).toBe(0);
  });

  it("round-trips a set value (including negative) through .jouer", () => {
    const text = createGameObject("text", { id: "t1", style: defaultTextStyle({ letterSpacing: -3 }) });
    const project = createProject("P", { scenes: [createScene("S", { objects: [text] })] });
    const back = projectFromJson(projectToJson(project));
    expect(findObject(activeScene(back), "t1")?.style?.letterSpacing).toBe(-3);
  });

  it("defaults letterSpacing to 0 for a document that omits it", () => {
    const partial = {
      schema: "monet-jouer/v1", name: "P", activeSceneId: "s1",
      scenes: [{ id: "s1", name: "S", objects: [{ id: "t1", kind: "text", name: "T", text: "hi", style: { fontFamily: "Arial", fontSize: 32 } }] }],
    };
    expect(findObject(activeScene(projectFromJson(JSON.stringify(partial))), "t1")?.style?.letterSpacing).toBe(0);
  });
});
