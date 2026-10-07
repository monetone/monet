import { describe, expect, it } from "vitest";
import {
  createGameObject,
  createKeyframe,
  createProject,
  createScene,
  createTimeline,
  createTrack,
  createTransition,
  createAsset,
  defaultBody,
  defaultAudioSource,
  defaultTextStyle,
} from "../model/factory";
import type { Project } from "../model/types";
import { projectFromJson, projectToJson } from "./jouer";
import { exportGameJs, exportStandaloneHtml } from "./export-phaser";
import { capsulePoints } from "../model/shapes";
import { scaleManagerSpec, textureFilterName } from "../model/render";

function richProject(): Project {
  const rect = createGameObject("rectangle", { name: "Hero", transform: { x: 100, y: 100, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 } });
  const label = createGameObject("text", { name: "Title", text: "Hello" });
  const tl = createTimeline("Main", {
    duration: 2,
    autoplay: true,
    loop: true,
    tracks: [
      // ease is applied on the segment *leaving* each keyframe, so put the
      // interesting easings on the first keyframe of each track.
      createTrack(rect.id, "x", [createKeyframe(0, 100, { ease: "bounceOut" }), createKeyframe(2, 400, { ease: "linear" })]),
      createTrack(rect.id, "alpha", [createKeyframe(0, 1, { ease: "hold" }), createKeyframe(2, 0.2, { ease: "linear" })]),
    ],
  });
  const sceneA = createScene("Scene A", { objects: [rect, label], timelines: [tl], activeTimelineId: tl.id });
  const sceneB = createScene("Scene B");
  const p = createProject("Demo", { scenes: [sceneA, sceneB], activeSceneId: sceneA.id });
  p.assets = [createAsset("image", "logo", "data:image/png;base64,iVBORw0KGgo=", { width: 32, height: 32 })];
  p.transitions = [createTransition(sceneA.id, sceneB.id, { kind: "fade", trigger: "pointerdown" })];
  return p;
}

describe("jouer io", () => {
  it("round-trips a project", () => {
    const p = richProject();
    const back = projectFromJson(projectToJson(p));
    expect(back.schema).toBe("monet-jouer/v1");
    expect(back.name).toBe("Demo");
    expect(back.scenes).toHaveLength(2);
    expect(back.activeSceneId).toBe(p.activeSceneId);
    const sa = back.scenes[0];
    expect(sa.objects.map((o) => o.name)).toEqual(["Hero", "Title"]);
    expect(sa.timelines[0].tracks).toHaveLength(2);
    expect(sa.timelines[0].tracks[0].keyframes[1].value).toBe(400);
    expect(back.transitions[0].trigger).toBe("pointerdown");
    expect(back.assets[0].name).toBe("logo");
  });

  it("rejects a file from another app instead of opening an empty 960x540 project", () => {
    // Cinema/Rythme/Anime `.monet` and Vision/Artisan `.monetgfx` carry `format`;
    // cinema's own timeline JSON carries a different `schema`; package.json carries
    // neither marker. All three used to normalise into a plausible blank project.
    const monet = JSON.stringify({ format: "monet", schemaVersion: 1, document: { name: "Cut", media: [], sequences: [] } });
    const cinema = JSON.stringify({ schema: "monet-cinema/v1", name: "Cut", tracks: [] });
    const pkg = JSON.stringify({ name: "monet-jouer", version: "0.1.0", dependencies: {} });
    // A `scenes` array is not a Jouer project either — only the `schema` says so.
    const tagless = JSON.stringify({ name: "Tagless", scenes: [] });
    for (const bad of [monet, cinema, pkg, tagless]) expect(() => projectFromJson(bad)).toThrow(/Monet Jouer/);
    expect(projectFromJson(projectToJson(richProject())).name).toBe("Demo");
  });

  it("round-trips a muted track (Unity Timeline track mute) and keeps an active track clean", () => {
    const rect = createGameObject("rectangle", { id: "r1" });
    const muted = { ...createTrack("r1", "x", [createKeyframe(0, 0), createKeyframe(1, 100)]), muted: true };
    const active = createTrack("r1", "y", [createKeyframe(0, 0), createKeyframe(1, 50)]);
    const tl = createTimeline("T", { tracks: [muted, active] });
    const scene = createScene("S", { objects: [rect], timelines: [tl], activeTimelineId: tl.id });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const tracks = back.scenes[0].timelines[0].tracks;
    expect(tracks.find((t) => t.property === "x")?.muted).toBe(true); // muted preserved
    expect(tracks.find((t) => t.property === "y")?.muted).toBeUndefined(); // active stays clean (no muted:false)
  });

  it("round-trips a soloed track (Unity Timeline track solo) and keeps a normal track clean", () => {
    const rect = createGameObject("rectangle", { id: "r1" });
    const soloed = { ...createTrack("r1", "x", [createKeyframe(0, 0), createKeyframe(1, 100)]), solo: true };
    const normal = createTrack("r1", "y", [createKeyframe(0, 0), createKeyframe(1, 50)]);
    const tl = createTimeline("T", { tracks: [soloed, normal] });
    const scene = createScene("S", { objects: [rect], timelines: [tl], activeTimelineId: tl.id });
    const tracks = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id }))).scenes[0].timelines[0].tracks;
    expect(tracks.find((t) => t.property === "x")?.solo).toBe(true); // solo preserved
    expect(tracks.find((t) => t.property === "y")?.solo).toBeUndefined(); // normal stays clean (no solo:false)
  });

  it("round-trips a locked track (Unity Timeline track lock) and keeps a normal track clean", () => {
    const rect = createGameObject("rectangle", { id: "r1" });
    const locked = { ...createTrack("r1", "x", [createKeyframe(0, 0), createKeyframe(1, 100)]), locked: true };
    const normal = createTrack("r1", "y", [createKeyframe(0, 0), createKeyframe(1, 50)]);
    const tl = createTimeline("T", { tracks: [locked, normal] });
    const scene = createScene("S", { objects: [rect], timelines: [tl], activeTimelineId: tl.id });
    const tracks = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id }))).scenes[0].timelines[0].tracks;
    expect(tracks.find((t) => t.property === "x")?.locked).toBe(true); // locked preserved
    expect(tracks.find((t) => t.property === "y")?.locked).toBeUndefined(); // normal stays clean (no locked:false)
  });

  it("round-trips the start scene (Unity Scenes In Build) and drops a stale id", () => {
    const menu = createScene("Menu");
    const level = createScene("Level");
    const proj = createProject("P", { scenes: [menu, level], activeSceneId: level.id, startSceneId: menu.id });
    expect(projectFromJson(projectToJson(proj)).startSceneId).toBe(menu.id); // preserved
    expect(projectFromJson(projectToJson({ ...proj, startSceneId: "ghost" })).startSceneId).toBeNull(); // stale → null
    expect(projectFromJson(projectToJson({ ...proj, startSceneId: null })).startSceneId).toBeNull(); // unset stays null
  });

  it("defaults the scene cameraZoom to 1 and round-trips a set value", () => {
    expect(createScene("S").cameraZoom).toBe(1);
    const scene = createScene("S", { cameraZoom: 2.5 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].cameraZoom).toBe(2.5);
  });

  it("defaults cameraZoom to 1 for a scene that omits it", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", scenes: [{ id: "s1", name: "S" }], activeSceneId: "s1" }));
    expect(back.scenes[0].cameraZoom).toBe(1);
  });

  it("defaults the scene cameraX/cameraY to 0 and round-trips set values", () => {
    expect(createScene("S").cameraX).toBe(0);
    expect(createScene("S").cameraY).toBe(0);
    const scene = createScene("S", { cameraX: 120, cameraY: -40 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect({ x: back.scenes[0].cameraX, y: back.scenes[0].cameraY }).toEqual({ x: 120, y: -40 });
  });

  it("defaults cameraX/cameraY to 0 for a scene that omits them", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", scenes: [{ id: "s1", name: "S" }], activeSceneId: "s1" }));
    expect({ x: back.scenes[0].cameraX, y: back.scenes[0].cameraY }).toEqual({ x: 0, y: 0 });
  });

  it("defaults the scene cameraRotation (Unity Cinemachine Dutch) to 0 and round-trips a set value", () => {
    expect(createScene("S").cameraRotation).toBe(0);
    const scene = createScene("S", { cameraRotation: 45 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].cameraRotation).toBe(45);
  });

  it("defaults cameraRotation to 0 for a scene that omits it", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", scenes: [{ id: "s1", name: "S" }], activeSceneId: "s1" }));
    expect(back.scenes[0].cameraRotation).toBe(0);
  });

  it("defaults the scene cameraFollowOffsetX/Y (Cinemachine follow offset) to 0 and round-trips set values", () => {
    expect(createScene("S").cameraFollowOffsetX).toBe(0);
    expect(createScene("S").cameraFollowOffsetY).toBe(0);
    const scene = createScene("S", { cameraFollowOffsetX: 40, cameraFollowOffsetY: -25 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect({ x: back.scenes[0].cameraFollowOffsetX, y: back.scenes[0].cameraFollowOffsetY }).toEqual({ x: 40, y: -25 });
  });

  it("defaults cameraFollowOffsetX/Y to 0 for a scene that omits them", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", scenes: [{ id: "s1", name: "S" }], activeSceneId: "s1" }));
    expect({ x: back.scenes[0].cameraFollowOffsetX, y: back.scenes[0].cameraFollowOffsetY }).toEqual({ x: 0, y: 0 });
  });

  it("fills defaults for partial files", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "Bare" }));
    expect(back.name).toBe("Bare");
    expect(back.scenes.length).toBeGreaterThanOrEqual(1);
    expect(back.width).toBe(960);
    expect(back.sortingLayers).toEqual(["Default"]); // always present
  });

  it("round-trips sorting layers and per-object layer assignment", () => {
    const hero = createGameObject("rectangle", { name: "Hero" });
    hero.sortingLayer = "Foreground";
    const scene = createScene("S", { objects: [hero] });
    const p = createProject("Layered", { scenes: [scene], activeSceneId: scene.id });
    p.sortingLayers = ["Default", "Foreground"];
    const back = projectFromJson(projectToJson(p));
    expect(back.sortingLayers).toEqual(["Default", "Foreground"]);
    expect(back.scenes[0].objects[0].sortingLayer).toBe("Foreground");
  });

  it("guarantees a Default layer even when the file omits it", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", sortingLayers: ["FX"] }));
    expect(back.sortingLayers).toContain("Default");
    expect(back.sortingLayers).toContain("FX");
  });

  it("round-trips tags and per-object tag assignment", () => {
    const hero = createGameObject("rectangle", { name: "Hero" });
    hero.tag = "Player";
    const scene = createScene("S", { objects: [hero] });
    const p = createProject("Tagged", { scenes: [scene], activeSceneId: scene.id });
    p.tags = ["Untagged", "Player", "Enemy"];
    const back = projectFromJson(projectToJson(p));
    expect(back.tags).toEqual(["Untagged", "Player", "Enemy"]);
    expect(back.scenes[0].objects[0].tag).toBe("Player");
  });

  it("guarantees an Untagged tag even when the file omits it", () => {
    const back = projectFromJson(JSON.stringify({ schema: "monet-jouer/v1", name: "X", tags: ["Boss"] }));
    expect(back.tags).toContain("Untagged");
    expect(back.tags).toContain("Boss");
  });

  it("round-trips the collider shape and defaults a bodied object to box", () => {
    const ball = createGameObject("ellipse", { name: "Ball" });
    ball.body = { bodyType: "dynamic", shape: "circle", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const crate = createGameObject("rectangle", { name: "Crate" });
    crate.body = { bodyType: "static", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: true, allowGravity: false };
    const scene = createScene("S", { objects: [ball, crate] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].objects[0].body?.shape).toBe("circle");
    expect(back.scenes[0].objects[1].body?.shape).toBe("box"); // omitted ⇒ box
  });

  it("round-trips rigidbody mass + drag and defaults a body that omits them", () => {
    const heavy = createGameObject("rectangle", { name: "Heavy" });
    heavy.body = { bodyType: "dynamic", mass: 5, drag: 2, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const plain = createGameObject("rectangle", { name: "Plain" });
    plain.body = { bodyType: "dynamic", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const scene = createScene("S", { objects: [heavy, plain] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect({ mass: back.scenes[0].objects[0].body?.mass, drag: back.scenes[0].objects[0].body?.drag }).toEqual({ mass: 5, drag: 2 });
    expect({ mass: back.scenes[0].objects[1].body?.mass, drag: back.scenes[0].objects[1].body?.drag }).toEqual({ mass: 1, drag: 0 }); // omitted ⇒ defaults
  });

  it("emits + round-trips rigidbody acceleration (Unity ConstantForce2D), dynamic bodies only", () => {
    const accel = createGameObject("rectangle", { name: "Accel" });
    accel.body = { bodyType: "dynamic", accelerationX: 30, accelerationY: -45, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const proj = createProject("P", { scenes: [createScene("S", { objects: [accel] })] });
    expect(exportGameJs(proj)).toContain("setAcceleration(30, -45)"); // continuous force on a dynamic body
    const a = projectFromJson(projectToJson(proj)).scenes[0].objects[0].body!;
    expect({ x: a.accelerationX, y: a.accelerationY }).toEqual({ x: 30, y: -45 }); // round-trips

    const plain = createGameObject("rectangle", { name: "Plain" });
    plain.body = { bodyType: "dynamic", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    expect(exportGameJs(createProject("P", { scenes: [createScene("S", { objects: [plain] })] }))).not.toContain("setAcceleration"); // default ⇒ none

    const kine = createGameObject("rectangle", { name: "Kine" });
    kine.body = { bodyType: "kinematic", accelerationX: 30, accelerationY: 0, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    expect(exportGameJs(createProject("P", { scenes: [createScene("S", { objects: [kine] })] }))).not.toContain("setAcceleration"); // kinematic ignores forces
  });

  it("emits + round-trips rigidbody angular acceleration (Unity ConstantForce2D torque), dynamic bodies only", () => {
    const spin = createGameObject("rectangle", { name: "Spin" });
    spin.body = { bodyType: "dynamic", angularAcceleration: 90, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const proj = createProject("P", { scenes: [createScene("S", { objects: [spin] })] });
    expect(exportGameJs(proj)).toContain("setAngularAcceleration(90)"); // continuous torque on a dynamic body
    expect(projectFromJson(projectToJson(proj)).scenes[0].objects[0].body!.angularAcceleration).toBe(90); // round-trips

    const neg = createGameObject("rectangle", { name: "Neg" });
    neg.body = { bodyType: "dynamic", angularAcceleration: -30, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    expect(exportGameJs(createProject("P", { scenes: [createScene("S", { objects: [neg] })] }))).toContain("setAngularAcceleration(-30)"); // negative emits

    const plain = createGameObject("rectangle", { name: "Plain" });
    plain.body = { bodyType: "dynamic", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    expect(exportGameJs(createProject("P", { scenes: [createScene("S", { objects: [plain] })] }))).not.toContain("setAngularAcceleration"); // default ⇒ none

    const kine = createGameObject("rectangle", { name: "Kine" });
    kine.body = { bodyType: "kinematic", angularAcceleration: 90, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    expect(exportGameJs(createProject("P", { scenes: [createScene("S", { objects: [kine] })] }))).not.toContain("setAngularAcceleration"); // kinematic ignores forces
  });

  it("round-trips rigidbody angular velocity, drag + freeze rotation and defaults a body that omits them", () => {
    const spinner = createGameObject("rectangle", { name: "Spinner" });
    spinner.body = { bodyType: "dynamic", angularVelocity: 180, angularDrag: 0.5, freezeRotation: true, velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const plain = createGameObject("rectangle", { name: "Plain" });
    plain.body = { bodyType: "dynamic", velocityX: 0, velocityY: 0, gravityY: 0, bounceX: 0, bounceY: 0, collideWorldBounds: true, immovable: false, allowGravity: true };
    const scene = createScene("S", { objects: [spinner, plain] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const a = back.scenes[0].objects[0].body!;
    expect({ av: a.angularVelocity, ad: a.angularDrag, fr: a.freezeRotation }).toEqual({ av: 180, ad: 0.5, fr: true });
    const b = back.scenes[0].objects[1].body!;
    expect({ av: b.angularVelocity, ad: b.angularDrag, fr: b.freezeRotation }).toEqual({ av: 0, ad: 0, fr: false }); // omitted ⇒ defaults
  });

  it("round-trips a triangle shape's geometry, fill and stroke", () => {
    const tri = createGameObject("triangle", { name: "Spike", width: 140, height: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
    const scene = createScene("S", { objects: [tri] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect(o.kind).toBe("triangle");
    expect({ w: o.width, h: o.height, fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth })
      .toEqual({ w: 140, h: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
  });

  it("round-trips a sprite's flipX/flipY (SpriteRenderer flip)", () => {
    const s = createGameObject("image", { name: "S", flipX: true, flipY: true });
    const scene = createScene("S", { objects: [s] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect({ flipX: o.flipX, flipY: o.flipY }).toEqual({ flipX: true, flipY: true });
  });

  it("round-trips an unflipped sprite as flipX/flipY false", () => {
    const s = createGameObject("sprite", { name: "S" });
    const scene = createScene("S", { objects: [s] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect({ flipX: o.flipX, flipY: o.flipY }).toEqual({ flipX: false, flipY: false });
  });

  it("round-trips a text object's wrapWidth + lineSpacing", () => {
    const t = createGameObject("text", { name: "T", style: defaultTextStyle({ wrapWidth: 120, lineSpacing: 8 }) });
    const scene = createScene("S", { objects: [t] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect({ w: o.style?.wrapWidth, ls: o.style?.lineSpacing }).toEqual({ w: 120, ls: 8 });
  });

  it("preserves a negative lineSpacing (tighter lines) through round-trip + export", () => {
    const t = createGameObject("text", { name: "T", style: defaultTextStyle({ lineSpacing: -6 }) });
    const scene = createScene("S", { objects: [t] });
    const proj = createProject("P", { scenes: [scene], activeSceneId: scene.id });
    expect(projectFromJson(projectToJson(proj)).scenes[0].objects[0].style?.lineSpacing).toBe(-6);
    expect(exportGameJs(proj)).toContain('"lineSpacing":-6');
  });

  it("round-trips a kinematic body type", () => {
    const o = createGameObject("rectangle", { name: "K", body: defaultBody({ bodyType: "kinematic" }) });
    const scene = createScene("S", { objects: [o] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].objects[0].body?.bodyType).toBe("kinematic");
  });

  it("exports a kinematic body as a non-static body with immovable + no gravity", () => {
    const o = createGameObject("rectangle", { name: "K", body: defaultBody({ bodyType: "kinematic", velocityX: 60, gravityY: 500 }) });
    const scene = createScene("S", { objects: [o] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).toMatch(/this\.physics\.add\.existing\([A-Za-z0-9_$]+\);/); // dynamic body (no ", true")
    expect(js).not.toMatch(/add\.existing\([A-Za-z0-9_$]+, true\)/);       // not static
    expect(js).toContain("setImmovable(true)");
    expect(js).toContain("setAllowGravity(false)");
    expect(js).toContain("setVelocity(60, 0)");
    expect(js).not.toContain("setGravityY"); // kinematic ignores gravity even if gravityY set
  });

  it("round-trips a hexagon shape's geometry, fill and stroke", () => {
    const hex = createGameObject("hexagon", { name: "Hex", width: 140, height: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
    const scene = createScene("S", { objects: [hex] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect(o.kind).toBe("hexagon");
    expect({ w: o.width, h: o.height, fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth })
      .toEqual({ w: 140, h: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
  });

  it("round-trips a flat-top hexagon shape's geometry, fill and stroke", () => {
    const hex = createGameObject("hexagonFlat", { name: "HexF", width: 120, height: 70, fill: "#00ddaa", stroke: "#202020", strokeWidth: 2 });
    const scene = createScene("S", { objects: [hex] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect(o.kind).toBe("hexagonFlat");
    expect({ w: o.width, h: o.height, fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth })
      .toEqual({ w: 120, h: 70, fill: "#00ddaa", stroke: "#202020", strokeWidth: 2 });
  });

  it("round-trips a diamond shape's geometry, fill and stroke", () => {
    const dia = createGameObject("diamond", { name: "Dia", width: 140, height: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
    const scene = createScene("S", { objects: [dia] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect(o.kind).toBe("diamond");
    expect({ w: o.width, h: o.height, fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth })
      .toEqual({ w: 140, h: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
  });

  it("round-trips a capsule shape's geometry, fill and stroke", () => {
    const cap = createGameObject("capsule", { name: "Cap", width: 140, height: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
    const scene = createScene("S", { objects: [cap] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const o = back.scenes[0].objects[0];
    expect(o.kind).toBe("capsule");
    expect({ w: o.width, h: o.height, fill: o.fill, stroke: o.stroke, strokeWidth: o.strokeWidth })
      .toEqual({ w: 140, h: 90, fill: "#ff0066", stroke: "#101010", strokeWidth: 3 });
  });

  it("round-trips a GameObject's active flag (Unity SetActive)", () => {
    const r = createGameObject("rectangle", { name: "R", active: false });
    const scene = createScene("S", { objects: [r] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].objects[0].active).toBe(false);
  });

  it("defaults active to true for legacy objects without the field", () => {
    const back = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "arcade", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [],
      scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540, backgroundColor: "#000", gravityY: 0,
        objects: [{ id: "o", kind: "rectangle", name: "Old" }], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(back.scenes[0].objects[0].active).toBe(true);
  });

  it("round-trips the pixelArt flag and defaults it false when absent (legacy)", () => {
    const back = projectFromJson(projectToJson(createProject("P", { pixelArt: true })));
    expect(back.pixelArt).toBe(true);
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "arcade", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [], scenes: [], activeSceneId: null,
    }));
    expect(legacy.pixelArt).toBe(false);
  });

  it("round-trips the physicsDebug flag and defaults it false when absent (legacy)", () => {
    expect(projectFromJson(projectToJson(createProject("P", { physicsDebug: true }))).physicsDebug).toBe(true);
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "arcade", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [], scenes: [], activeSceneId: null,
    }));
    expect(legacy.physicsDebug).toBe(false);
  });

  it("round-trips the scaleMode and defaults it to 'fit' when absent/unknown (legacy)", () => {
    expect(projectFromJson(projectToJson(createProject("P", { scaleMode: "resize" }))).scaleMode).toBe("resize");
    expect(projectFromJson(projectToJson(createProject("P", { scaleMode: "fixed" }))).scaleMode).toBe("fixed");
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "arcade", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [], scenes: [], activeSceneId: null,
    }));
    expect(legacy.scaleMode).toBe("fit");
    // an unknown/garbage value also falls back to the default, never leaks through
    expect(projectFromJson(JSON.stringify({ ...JSON.parse(projectToJson(createProject("P"))), scaleMode: "bogus" })).scaleMode).toBe("fit");
  });

  it("round-trips the masterVolume and clamps it to 0..1 (defaulting garbage to 1)", () => {
    expect(projectFromJson(projectToJson(createProject("P", { masterVolume: 0.4 }))).masterVolume).toBe(0.4);
    expect(createProject("P").masterVolume).toBe(1); // factory default
    const roundtrip = (v: unknown) => projectFromJson(JSON.stringify({ ...JSON.parse(projectToJson(createProject("P"))), masterVolume: v })).masterVolume;
    expect(roundtrip(1.5)).toBe(1); // clamped to max
    expect(roundtrip(-0.2)).toBe(0); // clamped to min
    expect(roundtrip("loud")).toBe(1); // garbage → default 1
  });

  it("round-trips scene gravityX and defaults it 0 for legacy scenes", () => {
    const scene = createScene("S", { gravityX: -120, gravityY: 500 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const bs = back.scenes.find((s) => s.id === scene.id)!;
    expect({ x: bs.gravityX, y: bs.gravityY }).toEqual({ x: -120, y: 500 });
    // legacy scene JSON without gravityX → defaults 0
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "arcade", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [],
      scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540, backgroundColor: "#000", gravityY: 8,
        objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(legacy.scenes[0].gravityX).toBe(0);
  });

  it("round-trips scene cameraFollowId and defaults it null when absent", () => {
    const hero = createGameObject("rectangle", { id: "hero" });
    const scene = createScene("S", { objects: [hero], cameraFollowId: "hero" });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes.find((s) => s.id === scene.id)!.cameraFollowId).toBe("hero");
    // legacy scene JSON without the field → null
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "none", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [],
      scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540, backgroundColor: "#000", gravityY: 0,
        objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(legacy.scenes[0].cameraFollowId).toBeNull();
  });

  it("round-trips scene cameraFollowLerp and defaults it 1 when absent", () => {
    const scene = createScene("S", { cameraFollowLerp: 0.3 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes.find((s) => s.id === scene.id)!.cameraFollowLerp).toBe(0.3);
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "none", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [],
      scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540, backgroundColor: "#000", gravityY: 0,
        objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(legacy.scenes[0].cameraFollowLerp).toBe(1);
    // an out-of-range / corrupt lerp is clamped to (0,1] so it can't freeze the camera
    const sceneOf = (lerp: unknown) => JSON.stringify({
      schema: "monet-jouer/v1", name: "P", scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540,
        backgroundColor: "#000", gravityY: 0, cameraFollowLerp: lerp, objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    });
    expect(projectFromJson(sceneOf(0)).scenes[0].cameraFollowLerp).toBe(0.05);
    expect(projectFromJson(sceneOf(5)).scenes[0].cameraFollowLerp).toBe(1);
  });

  it("round-trips scene cameraBounds and defaults it false when absent", () => {
    const scene = createScene("S", { cameraBounds: true });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes.find((s) => s.id === scene.id)!.cameraBounds).toBe(true);
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", width: 960, height: 540, fps: 60,
      backgroundColor: "#000", physics: "none", sortingLayers: ["Default"], tags: ["Untagged"],
      assets: [], animations: [], transitions: [],
      scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540, backgroundColor: "#000", gravityY: 0,
        objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(legacy.scenes[0].cameraBounds).toBe(false);
    // a non-boolean value coerces to false (strict === true)
    const str = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540,
        backgroundColor: "#000", gravityY: 0, cameraBounds: "yes", objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect(str.scenes[0].cameraBounds).toBe(false);
  });

  it("round-trips the camera dead-zone size and defaults it 0", () => {
    const scene = createScene("S", { cameraDeadzoneW: 150, cameraDeadzoneH: 90 });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const bs = back.scenes.find((s) => s.id === scene.id)!;
    expect({ w: bs.cameraDeadzoneW, h: bs.cameraDeadzoneH }).toEqual({ w: 150, h: 90 });
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540,
        backgroundColor: "#000", gravityY: 0, objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect({ w: legacy.scenes[0].cameraDeadzoneW, h: legacy.scenes[0].cameraDeadzoneH }).toEqual({ w: 0, h: 0 });
    // a corrupt negative dead-zone size is floored to 0
    const neg = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540,
        backgroundColor: "#000", gravityY: 0, cameraDeadzoneW: -50, cameraDeadzoneH: -10, objects: [], timelines: [], activeTimelineId: null }],
      activeSceneId: "s",
    }));
    expect({ w: neg.scenes[0].cameraDeadzoneW, h: neg.scenes[0].cameraDeadzoneH }).toEqual({ w: 0, h: 0 });
  });

  it("round-trips timeline speed and clamps a corrupt/absent value", () => {
    const tl = createTimeline("Main", { speed: 1.5 });
    const scene = createScene("S", { timelines: [tl], activeTimelineId: tl.id });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    expect(back.scenes[0].timelines[0].speed).toBe(1.5);
    // legacy timeline (no speed) → 1; corrupt 0 → clamped to the 0.1 floor
    const legacy = projectFromJson(JSON.stringify({
      schema: "monet-jouer/v1", name: "P", scenes: [{ id: "s", key: "s", name: "S", width: 960, height: 540,
        backgroundColor: "#000", gravityY: 0, objects: [], activeTimelineId: null,
        timelines: [{ id: "t1", name: "T", duration: 2, tracks: [] }, { id: "t2", name: "T2", duration: 2, speed: 0, tracks: [] }] }],
      activeSceneId: "s",
    }));
    expect(legacy.scenes[0].timelines[0].speed).toBe(1);
    expect(legacy.scenes[0].timelines[1].speed).toBe(0.1);
  });

  it("round-trips a collider offset", () => {
    const o = createGameObject("rectangle", { id: "h", body: defaultBody({ offsetX: 12, offsetY: 7 }) });
    const scene = createScene("S", { objects: [o] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const b = back.scenes[0].objects[0].body!;
    expect({ x: b.offsetX, y: b.offsetY }).toEqual({ x: 12, y: 7 });
  });

  it("round-trips an explicit box collider size + circle radius, defaulting a body that omits them", () => {
    const box = createGameObject("rectangle", { id: "bx", body: defaultBody({ sizeW: 120, sizeH: 48 }) });
    const circ = createGameObject("rectangle", { id: "ci", body: defaultBody({ shape: "circle", radius: 30 }) });
    const scene = createScene("S", { objects: [box, circ] });
    const back = projectFromJson(projectToJson(createProject("P", { scenes: [scene], activeSceneId: scene.id })));
    const bb = back.scenes[0].objects[0].body!;
    const cb = back.scenes[0].objects[1].body!;
    expect({ w: bb.sizeW, h: bb.sizeH }).toEqual({ w: 120, h: 48 });
    expect(cb.radius).toBe(30);
    // a default body auto-fits: size + radius are omitted (the 0 sentinel)
    expect(defaultBody().sizeW ?? 0).toBe(0);
    expect(defaultBody().sizeH ?? 0).toBe(0);
    expect(defaultBody().radius ?? 0).toBe(0);
  });

  it("round-trips an asset Filter Mode and defaults unknown/absent to undefined (inherit)", () => {
    const near = createAsset("image", "a", "data:,", { filterMode: "nearest" });
    const lin = createAsset("spritesheet", "b", "data:,", { filterMode: "linear", frameWidth: 16, frameHeight: 16 });
    const plain = createAsset("image", "c", "data:,");
    const p = createProject("P");
    p.assets = [near, lin, plain];
    const back = projectFromJson(projectToJson(p));
    expect(back.assets.map((a) => a.filterMode)).toEqual(["nearest", "linear", undefined]);
    // an unknown value normalizes to undefined (inherit), never leaks through
    const bogus = projectFromJson(JSON.stringify({ ...JSON.parse(projectToJson(p)), assets: [{ id: "x", kind: "image", name: "x", src: "data:,", filterMode: "trilinear" }] }));
    expect(bogus.assets[0].filterMode).toBeUndefined();
  });

  it("rejects invalid json", () => {
    expect(() => projectFromJson("not json")).toThrow();
  });
});

describe("phaser export", () => {
  it("generates a runnable game module", () => {
    const js = exportGameJs(richProject());
    expect(js).toContain("class SceneA extends Phaser.Scene");
    expect(js).toContain("class SceneB extends Phaser.Scene");
    expect(js).toContain("this.add.rectangle(");
    expect(js).toContain("this.add.text(");
    expect(js).toContain("this.tweens.chain(");
    expect(js).toContain("loop: -1"); // looping timeline
    expect(js).toContain("ease: 'Bounce.easeOut'");
    expect(js).toContain("function (t) { return t < 1 ? 0 : 1; }"); // hold ease
    expect(js).toContain("mjTransition(this, 'Scene_B'"); // transition target key
    expect(js).toContain("this.input.once('pointerdown'");
    expect(js).toContain("new Phaser.Game(config)");
    // active scene listed first
    expect(js.indexOf("scene: [SceneA")).toBeGreaterThan(-1);
  });

  it("emits pixelArt in the game config reflecting the project flag", () => {
    const scene = createScene("S", { objects: [] });
    const off = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(off).toContain("pixelArt: false,");
    const on = exportGameJs(createProject("P", { pixelArt: true, scenes: [scene], activeSceneId: scene.id }));
    expect(on).toContain("pixelArt: true,");
    expect(on).not.toContain("pixelArt: false,");
    // exactly one pixelArt line — the invariant the negative assertions rely on
    expect((on.match(/pixelArt:/g) ?? []).length).toBe(1);
  });

  it("emits the arcade physics debug flag reflecting project.physicsDebug (Unity Physics 2D Debugger)", () => {
    const scene = createScene("S", { objects: [] });
    const off = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(off).toContain("debug: false }"); // default arcade config draws nothing
    const on = exportGameJs(createProject("P", { physicsDebug: true, scenes: [scene], activeSceneId: scene.id }));
    expect(on).toContain("debug: true }"); // debug draw enabled
    expect(on).not.toContain("debug: false"); // debug appears only once, in the arcade config
    // exactly one debug line — the invariant the negative assertion relies on
    expect((on.match(/debug:/g) ?? []).length).toBe(1);
  });

  it("maps scaleMode to a Phaser Scale Manager mode + centering (Unity Resolution & Presentation)", () => {
    expect(scaleManagerSpec(createProject("P", { scaleMode: "fit" }))).toEqual({ mode: "FIT", center: true });
    expect(scaleManagerSpec(createProject("P", { scaleMode: "fixed" }))).toEqual({ mode: "NONE", center: true });
    expect(scaleManagerSpec(createProject("P", { scaleMode: "resize" }))).toEqual({ mode: "RESIZE", center: false });
    // unknown/legacy value falls back to FIT (coercion-safe, mirrors normalizeProject)
    expect(scaleManagerSpec({ scaleMode: "bogus" } as never)).toEqual({ mode: "FIT", center: true });
  });

  it("emits the Phaser Scale Manager config reflecting project.scaleMode (Unity Resolution & Presentation)", () => {
    const scene = createScene("S", { objects: [] });
    const fit = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id })); // default
    expect(fit).toContain("scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },");
    const resize = exportGameJs(createProject("P", { scaleMode: "resize", scenes: [scene], activeSceneId: scene.id }));
    expect(resize).toContain("scale: { mode: Phaser.Scale.RESIZE },");
    expect(resize).not.toContain("CENTER_BOTH"); // resize fills the window — no autoCenter
    const fixed = exportGameJs(createProject("P", { scaleMode: "fixed", scenes: [scene], activeSceneId: scene.id }));
    expect(fixed).toContain("scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },");
  });

  it("sets the global sound volume from masterVolume (Unity AudioListener.volume)", () => {
    const scene = createScene("S", { objects: [] });
    const quiet = exportGameJs(createProject("P", { masterVolume: 0.5, scenes: [scene], activeSceneId: scene.id }));
    expect(quiet).toContain("this.sound.volume = 0.5;");
    // default (1) emits nothing — Phaser's default full volume ("this.sound.volume" is distinct from "this.sound.play")
    const full = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(full).not.toContain("this.sound.volume");
  });

  it("emits the 2D gravity vector (x and y) only for non-zero components", () => {
    const scene = createScene("S", { objects: [], gravityX: 300, gravityY: 980 });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).toContain("this.physics.world.gravity.x = 300;");
    expect(js).toContain("this.physics.world.gravity.y = 980;");
    // a default (0,0) scene emits neither line
    const flat = createScene("F", { objects: [] });
    const none = exportGameJs(createProject("P", { scenes: [flat], activeSceneId: flat.id }));
    expect(none).not.toContain("world.gravity.x");
    expect(none).not.toContain("world.gravity.y");
  });

  it("emits camera.startFollow only when cameraFollowId resolves to a built object", () => {
    const hero = createGameObject("rectangle", { id: "hero", name: "Hero" });
    const follow = createScene("S", { objects: [hero], cameraFollowId: "hero" });
    expect(exportGameJs(createProject("P", { scenes: [follow], activeSceneId: follow.id })))
      .toContain("this.cameras.main.startFollow(");
    // a default scene (no follow) emits nothing
    const plain = createScene("S", { objects: [createGameObject("rectangle", { id: "x" })] });
    expect(exportGameJs(createProject("P", { scenes: [plain], activeSceneId: plain.id }))).not.toContain("startFollow");
    // a stale id (no such object) emits nothing
    const stale = createScene("S", { objects: [createGameObject("rectangle", { id: "x" })], cameraFollowId: "ghost" });
    expect(exportGameJs(createProject("P", { scenes: [stale], activeSceneId: stale.id }))).not.toContain("startFollow");
  });

  it("emits the camera follow offset (Cinemachine tracked-object offset) as startFollow args 5-6 only when set", () => {
    const mk = (over: Record<string, unknown>) => {
      const hero = createGameObject("rectangle", { id: "hero", name: "Hero" });
      const scene = createScene("S", { objects: [hero], cameraFollowId: "hero", ...over });
      return exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    };
    // offset with the default lerp (1) → full 6-arg form (lerp included)
    expect(mk({ cameraFollowOffsetX: 40, cameraFollowOffsetY: -25 })).toContain(", false, 1, 1, 40, -25)");
    // offset combined with a non-default lerp
    expect(mk({ cameraFollowLerp: 0.5, cameraFollowOffsetX: 40, cameraFollowOffsetY: -25 })).toContain(", false, 0.5, 0.5, 40, -25)");
    // a follow with no offset keeps the short forms (no trailing offset args)
    expect(mk({})).toContain("startFollow(");
    expect(mk({})).not.toContain(", false,"); // plain 1-arg form, no lerp/offset args
    expect(mk({ cameraFollowLerp: 0.5 })).toContain(", false, 0.5, 0.5)"); // 4-arg form ends right after lerp (closing paren) — no offset args appended
  });

  it("emits camera.setRotation (Unity Cinemachine Dutch) only when cameraRotation !== 0, as degrees→radians", () => {
    const scene = createScene("S", { cameraRotation: 45 });
    const rad = Math.round((45 * Math.PI) / 180 * 1000) / 1000; // matches the exporter's r2 (3-decimal) rounding
    expect(exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id })))
      .toContain(`this.cameras.main.setRotation(${rad})`);
    // a default (upright) scene emits no camera rotation
    const plain = createScene("S");
    expect(exportGameJs(createProject("P", { scenes: [plain], activeSceneId: plain.id }))).not.toContain("this.cameras.main.setRotation(");
  });

  it("scales the chain timeScale (Unity Animator speed) only when speed !== 1", () => {
    const mkScene = (speed: number) => {
      const hero = createGameObject("rectangle", { id: "hero", name: "Hero" });
      const tl = createTimeline("Main", { speed, tracks: [createTrack(hero.id, "x", [createKeyframe(0, 0), createKeyframe(1, 200)])] });
      return createScene("S", { objects: [hero], timelines: [tl], activeTimelineId: tl.id });
    };
    const fast = mkScene(2);
    const js = exportGameJs(createProject("P", { scenes: [fast], activeSceneId: fast.id }));
    expect(js).toContain("Object.assign(this.tweens.chain({");
    expect(js).toContain("}), { timeScale: 2 }));");
    // default speed 1 → plain chain, no Object.assign / timeScale wrapper
    const normal = mkScene(1);
    const js1 = exportGameJs(createProject("P", { scenes: [normal], activeSceneId: normal.id }));
    expect(js1).toContain("this.tweens.chain({");
    expect(js1).not.toContain("Object.assign");
    expect(js1).not.toContain("timeScale");
  });

  it("emits no tween for a muted track (Unity Timeline track mute)", () => {
    const mk = (muted: boolean) => {
      const hero = createGameObject("rectangle", { id: "hero", name: "Hero" });
      const track = { ...createTrack(hero.id, "x", [createKeyframe(0, 0), createKeyframe(1, 200)]), muted };
      const tl = createTimeline("Main", { tracks: [track] });
      const scene = createScene("S", { objects: [hero], timelines: [tl], activeTimelineId: tl.id });
      return exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    };
    expect(mk(false)).toContain("this.tweens.chain("); // active track → a tween chain
    expect(mk(true)).not.toContain("this.tweens.chain("); // muted track → no chain (chains are unique to timeline tracks)
  });

  it("exports only soloed tracks when any track is soloed (Unity Timeline solo)", () => {
    const mk = (xSolo: boolean) => {
      const hero = createGameObject("rectangle", { id: "hero", name: "Hero" });
      const xt = { ...createTrack(hero.id, "x", [createKeyframe(0, 0), createKeyframe(1, 200)]), ...(xSolo ? { solo: true } : {}) };
      const yt = createTrack(hero.id, "y", [createKeyframe(0, 0), createKeyframe(1, 150)]);
      const tl = createTimeline("Main", { tracks: [xt, yt] });
      const scene = createScene("S", { objects: [hero], timelines: [tl], activeTimelineId: tl.id });
      return exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    };
    const none = mk(false); // nothing soloed → both tracks export
    expect(none).toContain("{ x: 200");
    expect(none).toContain("{ y: 150");
    const xOnly = mk(true); // x soloed → only x exports (y is silenced)
    expect(xOnly).toContain("{ x: 200");
    expect(xOnly).not.toContain("{ y: 150");
  });

  it("boots the start scene (Unity Scenes In Build) first, else the active scene", () => {
    const menu = createScene("Menu");
    const level = createScene("Level");
    const proj = createProject("P", { scenes: [menu, level], activeSceneId: level.id });
    const firstClass = (js: string) => js.match(/scene: \[(\w+)/)?.[1];
    const order = (js: string) => js.match(/scene: \[([^\]]+)\]/)?.[1].split(", ");
    const def = exportGameJs(proj); // no start scene → active (Level) boots first
    const withStart = exportGameJs({ ...proj, startSceneId: menu.id }); // Menu boots first, though Level is active
    expect(firstClass(def)).toBeTruthy();
    expect(firstClass(withStart)).not.toBe(firstClass(def)); // boot scene changed
    expect(firstClass(withStart)).toBe(order(def)?.[1]); // Menu was 2nd by default, now leads
  });

  it("emits the AudioSource pitch (rate) + pan in the sound.play config", () => {
    const clip = createAsset("audio", "boom", "data:audio/wav;base64,UklGRiQAAABXQVZF");
    const mk = (over: object) => {
      const o = createGameObject("rectangle", { audio: defaultAudioSource({ assetId: clip.id, ...over }) });
      const proj = createProject("P", { scenes: [createScene("S", { objects: [o] })], activeSceneId: undefined as never });
      proj.assets = [clip];
      proj.activeSceneId = proj.scenes[0].id;
      return exportGameJs(proj);
    };
    const js = mk({ pitch: 1.5, pan: -0.5 });
    expect(js).toContain('"rate":1.5');
    expect(js).toContain('"pan":-0.5');
    // a default-pitch/centre AudioSource has no rate/pan in its play config
    const plain = mk({});
    expect(plain).toContain("this.sound.play('boom')"); // no config object at all
    expect(plain).not.toContain('"rate"');
    expect(plain).not.toContain('"pan"');
    // Unity AudioSource Mute → the play config's mute flag, only when muted
    expect(mk({ mute: true })).toContain('"mute":true');
    expect(plain).not.toContain('"mute"');
  });

  it("emits the collider offset (Unity Collider2D Offset) for box and circle bodies", () => {
    const mk = (shape: "box" | "circle") => {
      const o = createGameObject("rectangle", { id: "h", width: 100, height: 100, body: defaultBody({ shape, offsetX: 8, offsetY: -4 }) });
      const scene = createScene("S", { objects: [o] });
      return exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    };
    expect(mk("box")).toContain(".setOffset(8, -4);"); // box → body.setOffset
    expect(mk("circle")).toContain(".setCircle(50, 8, -4);"); // 100×100 → r50, centre 0,0; offset folded in
    // non-square circle: 120×80 → r40, centre (20,0); user offset folds onto the centring
    const wide = createGameObject("rectangle", { id: "h", width: 120, height: 80, body: defaultBody({ shape: "circle", offsetX: 8, offsetY: -4 }) });
    const ws = createScene("S", { objects: [wide] });
    expect(exportGameJs(createProject("P", { scenes: [ws], activeSceneId: ws.id }))).toContain(".setCircle(40, 28, -4);");
    // a default body (no offset) emits no setOffset
    const plain = createGameObject("rectangle", { id: "h", width: 100, height: 100, body: defaultBody() });
    const ps = createScene("S", { objects: [plain] });
    expect(exportGameJs(createProject("P", { scenes: [ps], activeSceneId: ps.id }))).not.toContain("setOffset");
  });

  it("emits the explicit collider size (Unity BoxCollider2D.Size / CircleCollider2D.Radius)", () => {
    const exp = (body: ReturnType<typeof defaultBody>) => {
      const o = createGameObject("rectangle", { id: "h", width: 100, height: 100, body });
      const scene = createScene("S", { objects: [o] });
      return exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    };
    // box: explicit Size → body.setSize
    expect(exp(defaultBody({ sizeW: 120, sizeH: 48 }))).toContain(".setSize(120, 48);");
    // circle: explicit Radius overrides the auto-fit; 100×100, r30 → centre (20,20)
    expect(exp(defaultBody({ shape: "circle", radius: 30 }))).toContain(".setCircle(30, 20, 20);");
    // size + offset: setSize must come BEFORE setOffset (setSize re-centres)
    const both = exp(defaultBody({ sizeW: 120, sizeH: 48, offsetX: 8, offsetY: -4 }));
    expect(both.indexOf(".setSize(120, 48);")).toBeLessThan(both.indexOf(".setOffset(8, -4);"));
    // both axes are required: a single-axis size is ignored (auto-fit kept)
    expect(exp(defaultBody({ sizeW: 120 }))).not.toContain("setSize");
    // a default body emits no setSize (auto-fit preserved)
    expect(exp(defaultBody())).not.toContain("setSize");
  });

  it("applies the follow lerp (Cinemachine damping) only when not 1", () => {
    const hero = createGameObject("rectangle", { id: "hero" });
    const smooth = createScene("S", { objects: [hero], cameraFollowId: "hero", cameraFollowLerp: 0.2 });
    const smoothJs = exportGameJs(createProject("P", { scenes: [smooth], activeSceneId: smooth.id }));
    expect(smoothJs).toContain("this.cameras.main.startFollow(");
    expect(smoothJs).toContain(", false, 0.2, 0.2);"); // the lerp args
    // default lerp 1 emits the plain (instant) startFollow — no lerp args
    const instant = createScene("S", { objects: [createGameObject("rectangle", { id: "hero" })], cameraFollowId: "hero" });
    const instantJs = exportGameJs(createProject("P", { scenes: [instant], activeSceneId: instant.id }));
    expect(instantJs).toContain("this.cameras.main.startFollow(");
    expect(instantJs).not.toContain(", false,"); // no lerp args on the plain form
  });

  it("confines the main camera to the scene rect only when cameraBounds is on", () => {
    const bounded = createScene("S", { width: 1280, height: 720, cameraBounds: true });
    expect(exportGameJs(createProject("P", { scenes: [bounded], activeSceneId: bounded.id })))
      .toContain("this.cameras.main.setBounds(0, 0, 1280, 720);");
    // a default scene emits no camera bounds (the physics world setBounds is a different call)
    const plain = createScene("S");
    expect(exportGameJs(createProject("P", { scenes: [plain], activeSceneId: plain.id }))).not.toContain("this.cameras.main.setBounds(");
  });

  it("sets the camera dead zone only when sized (Unity Cinemachine Dead Zone)", () => {
    const dz = createScene("S", { cameraDeadzoneW: 200, cameraDeadzoneH: 120 });
    expect(exportGameJs(createProject("P", { scenes: [dz], activeSceneId: dz.id })))
      .toContain("this.cameras.main.setDeadzone(200, 120);");
    // a single-axis (W-only) dead zone still emits (OR gate)
    const wOnly = createScene("S", { cameraDeadzoneW: 100, cameraDeadzoneH: 0 });
    expect(exportGameJs(createProject("P", { scenes: [wOnly], activeSceneId: wOnly.id })))
      .toContain("this.cameras.main.setDeadzone(100, 0);");
    const plain = createScene("S");
    expect(exportGameJs(createProject("P", { scenes: [plain], activeSceneId: plain.id }))).not.toContain("setDeadzone");
  });

  it("emits a triangle as add.triangle with isosceles points + a stroke setter", () => {
    const tri = createGameObject("triangle", { name: "Spike", transform: { x: 200, y: 150, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 }, width: 100, height: 80, fill: "#f472b6", stroke: "#101010", strokeWidth: 4 });
    const scene = createScene("S", { objects: [tri] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    // apex top-centre (w/2,0), base corners (0,h)/(w,h) → bounding box 100×80.
    expect(js).toContain("this.add.triangle(200, 150, 0, 80, 50, 0, 100, 80, 0xf472b6)");
    expect(js).toContain("setStrokeStyle(4, 0x101010)");
  });

  it("emits setFlipX/setFlipY only for a flipped sprite", () => {
    const flipped = createGameObject("image", { name: "F", flipX: true, flipY: true });
    const plain = createGameObject("image", { name: "P" });
    const scene = createScene("S", { objects: [flipped, plain] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).toContain("setFlipX(true)");
    expect(js).toContain("setFlipY(true)");
    // exactly one object is flipped → one of each setter
    expect((js.match(/setFlipX\(true\)/g) || []).length).toBe(1);
    expect((js.match(/setFlipY\(true\)/g) || []).length).toBe(1);
  });

  it("never emits setFlip for a non-sprite, even if it carries a stray flipX", () => {
    const rect = createGameObject("rectangle", { name: "R" });
    (rect as { flipX?: boolean }).flipX = true; // shapes can't render-flip
    const scene = createScene("S", { objects: [rect] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).not.toContain("setFlipX");
  });

  it("emits text wordWrap + lineSpacing when set, and omits wordWrap when wrapWidth is 0", () => {
    const wrapped = createGameObject("text", { name: "W", style: defaultTextStyle({ wrapWidth: 100, lineSpacing: 12 }) });
    const plain = createGameObject("text", { name: "P" });
    const sceneW = createScene("W", { objects: [wrapped] });
    const sceneP = createScene("P2", { objects: [plain] });
    const jsW = exportGameJs(createProject("P", { scenes: [sceneW], activeSceneId: sceneW.id }));
    const jsP = exportGameJs(createProject("Q", { scenes: [sceneP], activeSceneId: sceneP.id }));
    expect(jsW).toContain('"wordWrap":{"width":100,"useAdvancedWrap":true}');
    expect(jsW).toContain('"lineSpacing":12');
    expect(jsP).not.toContain("wordWrap"); // no wrap when width 0
    expect(jsP).toContain('"lineSpacing":0');
  });

  it("emits a hexagon as add.polygon with the point-top AABB-filling points", () => {
    const hex = createGameObject("hexagon", { name: "Hex", transform: { x: 200, y: 150, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 }, width: 100, height: 80, fill: "#fbbf24", stroke: "#101010", strokeWidth: 4 });
    const scene = createScene("S", { objects: [hex] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    // hexagonPoints(100, 80) = [50,0, 100,20, 100,60, 50,80, 0,60, 0,20]
    expect(js).toContain("this.add.polygon(200, 150, [50,0,100,20,100,60,50,80,0,60,0,20], 0xfbbf24)");
    expect(js).toContain("setStrokeStyle(4, 0x101010)");
  });

  it("emits a flat-top hexagon as add.polygon with the flat-top AABB-filling points", () => {
    const hex = createGameObject("hexagonFlat", { name: "HexF", transform: { x: 200, y: 150, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 }, width: 100, height: 80, fill: "#fbbf24", stroke: "#101010", strokeWidth: 4 });
    const scene = createScene("S", { objects: [hex] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    // hexagonFlatPoints(100, 80) = [25,0, 75,0, 100,40, 75,80, 25,80, 0,40]
    expect(js).toContain("this.add.polygon(200, 150, [25,0,75,0,100,40,75,80,25,80,0,40], 0xfbbf24)");
    expect(js).toContain("setStrokeStyle(4, 0x101010)");
  });

  it("emits a diamond as add.polygon with the box-inscribed rhombus points", () => {
    const dia = createGameObject("diamond", { name: "Dia", transform: { x: 200, y: 150, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 }, width: 100, height: 80, fill: "#a78bfa", stroke: "#101010", strokeWidth: 4 });
    const scene = createScene("S", { objects: [dia] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    // diamondPoints(100, 80) = [50,0, 100,40, 50,80, 0,40]
    expect(js).toContain("this.add.polygon(200, 150, [50,0,100,40,50,80,0,40], 0xa78bfa)");
    expect(js).toContain("setStrokeStyle(4, 0x101010)");
  });

  it("emits a capsule as add.polygon with the stadium points", () => {
    const cap = createGameObject("capsule", { name: "Cap", transform: { x: 200, y: 150, scaleX: 1, scaleY: 1, angle: 0, originX: 0.5, originY: 0.5, alpha: 1 }, width: 100, height: 80, fill: "#2dd4bf", stroke: "#101010", strokeWidth: 4 });
    const scene = createScene("S", { objects: [cap] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    // points mirror the runtime/player helper, rounded to 3dp by the exporter
    const pts = JSON.stringify(capsulePoints(100, 80).map((n) => Math.round(n * 1000) / 1000));
    expect(js).toContain(`this.add.polygon(200, 150, ${pts}, 0x2dd4bf)`);
    expect(js).toContain("setStrokeStyle(4, 0x101010)");
  });

  it("exports an inactive object as setVisible(false).setActive(false) and skips its physics body", () => {
    const r = createGameObject("rectangle", { name: "Foe", active: false, body: defaultBody({ velocityX: 50 }) });
    const scene = createScene("S", { objects: [r] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).toContain("setVisible(false)");
    expect(js).toContain("setActive(false)");
    expect(js).not.toContain("this.physics.add.existing"); // body skipped while inactive
  });

  it("emits no setActive(false) for an active object", () => {
    const r = createGameObject("rectangle", { name: "Hero" });
    const scene = createScene("S", { objects: [r] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).not.toContain("setActive(false)");
  });

  it("cascades: a child under an inactive container loses its body (activeInHierarchy)", () => {
    const child = createGameObject("rectangle", { name: "Kid", body: defaultBody({ velocityX: 10 }) }); // active by default
    const group = createGameObject("container", { name: "Grp", active: false, children: [child] });
    const scene = createScene("S", { objects: [group] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).not.toContain("this.physics.add.existing"); // child body skipped under inactive parent
    // only the container is self-inactive → exactly one setActive(false); the child is active-self
    expect((js.match(/setActive\(false\)/g) || []).length).toBe(1);
  });

  it("cascades through nested levels: only the top inactive object emits setActive(false), no descendant keeps a body", () => {
    const leaf = createGameObject("rectangle", { name: "Leaf", body: defaultBody({ velocityX: 5 }) }); // active-self
    const mid = createGameObject("container", { name: "Mid", children: [leaf] }); // active-self
    const top = createGameObject("container", { name: "Top", active: false, children: [mid] }); // inactive
    const scene = createScene("S", { objects: [top] });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).not.toContain("this.physics.add.existing"); // leaf body skipped (grandparent inactive)
    expect((js.match(/setActive\(false\)/g) || []).length).toBe(1); // only Top is self-inactive
  });

  it("wraps a standalone html with a CDN phaser", () => {
    const html = exportStandaloneHtml(richProject());
    expect(html).toContain("<script src=\"https://cdn.jsdelivr.net/npm/phaser@4.1.0/");
    expect(html).toContain("new Phaser.Game(config)");
    expect(html).toContain("<!doctype html>");
  });

  it("pins the CDN to the chosen engine version", () => {
    const html = exportStandaloneHtml(richProject(), "3.90.0");
    expect(html).toContain("cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js");
    const html4 = exportStandaloneHtml(richProject(), "4.0.0");
    expect(html4).toContain("phaser@4.0.0/dist/phaser.min.js");
  });

  it("emits preload for referenced assets only", () => {
    const js = exportGameJs(richProject());
    // logo asset isn't used by any object → not preloaded
    expect(js).not.toContain("this.load.image('logo'");
  });

  it("paused timelines get a playable handle and looping chains are padded to the extent", () => {
    const rect = createGameObject("rectangle", { name: "R" });
    const tl = createTimeline("Intro", {
      duration: 3, loop: true, autoplay: false,
      tracks: [createTrack(rect.id, "x", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(1, 100, { ease: "linear" })])],
    });
    const scene = createScene("S", { objects: [rect], timelines: [tl], activeTimelineId: tl.id });
    const js = exportGameJs(createProject("P", { scenes: [scene], activeSceneId: scene.id }));
    expect(js).toContain("this.mjTimelines = this.mjTimelines || {}");
    expect(js).toContain('this.mjTimelines["Intro"]');
    expect(js).toContain("paused: true");
    expect(js).toContain(".play());"); // the "start it with…" hint
    expect(js).toContain("duration: 2000"); // trailing hold pads the chain 1s→3s extent
  });

  it("maps sprite size tracks to displayWidth/displayHeight; origin tracks stay editor-only", () => {
    const asset = createAsset("image", "tex", "data:image/png;base64,iVBORw0KGgo=", { width: 32, height: 32 });
    const sprite = createGameObject("image", { name: "S", assetId: asset.id });
    const tl = createTimeline("M", {
      duration: 1, autoplay: true,
      tracks: [
        createTrack(sprite.id, "width", [createKeyframe(0, 32, { ease: "linear" }), createKeyframe(1, 64, { ease: "linear" })]),
        createTrack(sprite.id, "originX", [createKeyframe(0, 0, { ease: "linear" }), createKeyframe(1, 1, { ease: "linear" })]),
      ],
    });
    const scene = createScene("S", { objects: [sprite], timelines: [tl], activeTimelineId: tl.id });
    const p = createProject("P", { scenes: [scene], activeSceneId: scene.id });
    p.assets = [asset];
    const js = exportGameJs(p);
    expect(js).toContain("displayWidth:"); // width → displayWidth tween
    expect(js).not.toContain("originX:");  // origin track not tweened
    expect(js).toContain("origin/size track(s) animate in the editor only");
  });

  it("maps an asset's Filter Mode to the Phaser FilterMode name (Unity Texture Import)", () => {
    expect(textureFilterName({ kind: "image", filterMode: "nearest" })).toBe("NEAREST");
    expect(textureFilterName({ kind: "spritesheet", filterMode: "linear" })).toBe("LINEAR");
    expect(textureFilterName({ kind: "image", filterMode: undefined })).toBeNull(); // inherit global
    expect(textureFilterName({ kind: "audio", filterMode: "nearest" })).toBeNull(); // no texture
  });

  it("emits texture.setFilter for assets with an explicit Filter Mode (Unity Texture Import)", () => {
    const mk = (filterMode?: "nearest" | "linear") => {
      const asset = createAsset("image", "tex", "data:image/png;base64,iVBORw0KGgo=", { width: 32, height: 32, filterMode });
      const sprite = createGameObject("image", { name: "S", assetId: asset.id });
      const scene = createScene("S", { objects: [sprite] });
      const p = createProject("P", { scenes: [scene], activeSceneId: scene.id });
      p.assets = [asset];
      return exportGameJs(p);
    };
    expect(mk("nearest")).toContain("this.textures.get('tex').setFilter(Phaser.Textures.FilterMode.NEAREST);");
    expect(mk("linear")).toContain("this.textures.get('tex').setFilter(Phaser.Textures.FilterMode.LINEAR);");
    expect(mk(undefined)).not.toContain("setFilter"); // a default asset inherits the global pixelArt default
  });
});
