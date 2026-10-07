// ─────────────────────────────────────────────────────────────
// jouer.ts — (de)serialise a Project to/from the self-contained scene JSON
// (schema `monet-jouer/v1`) and wrap it in the universal Monet container as
// `scene.json` / role `scene` (docs/plans/11-universal-container.md). The parser
// requires that schema and is otherwise defensive: every missing or out-of-range
// field is clamped to a sane default, so a truncated or hostile file can't
// produce an unusable project.
// ─────────────────────────────────────────────────────────────

import {
  createContainer,
  entriesByRole,
  setEntry,
  type MonetContainer,
} from "@monet-ui/monet-format";
import { SCHEMA_ID } from "../model/types";
import type {
  Asset,
  AudioSource,
  GameObject,
  Project,
  Scene,
  SpriteAnimation,
  Timeline,
  AnimTrack,
  Transition,
} from "../model/types";
import {
  createProject,
  createScene,
  createTimeline,
  defaultAudioSource,
  defaultBody,
  defaultTextStyle,
  defaultTransform,
  uid,
} from "../model/factory";
import { isEaseId } from "../model/ease";

export function projectToJson(project: Project): string {
  return JSON.stringify({ ...project, schema: SCHEMA_ID }, null, 2);
}

export function projectFromJson(json: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Not a valid Jouer scene (invalid JSON).");
  }
  if (!raw || typeof raw !== "object") throw new Error("Not a valid Jouer scene.");
  const obj = raw as Record<string, unknown>;
  // Discriminator check. Every save writes `schema`, so anything else — another
  // app's document entry that happens to sit at a `scene` role, a package.json —
  // must fail loudly:
  // normalising it would silently open a plausible, empty 960x540 project and the
  // user's real file would look lost.
  const schema = obj.schema;
  if (schema !== SCHEMA_ID) {
    const what = typeof schema === "string" ? `this file's schema is "${schema}"`
      : typeof obj.format === "string" ? `this is a "${obj.format}" document`
      : "it carries no `schema`";
    throw new Error(`Not a Monet Jouer project — ${what}.`);
  }
  return normalizeProject(obj);
}

// ── the universal container (design doc 11) ──────────────────
/** Jouer's one entry: the scene document, dispatched on its ROLE, never its path. */
export const SCENE_PATH = "scene.json";
export const SCENE_ROLE = "scene";

// ponytail: version pinned here rather than read from package.json — the app has
// no version constant yet; wire it up when a release actually needs to differ.
const APP = { name: "monet-jouer", version: "0.1.0" } as const;

/**
 * Wrap `project` as `scene.json` inside `base` — the container it was opened
 * from, so every entry and manifest field Jouer does not own travels with it
 * (rule 2) — or inside a fresh `scene` container.
 *
 * `base.manifest.kind` is left alone: it names the payload class the document
 * arrived as, and relabelling another app's document is not couriering it.
 */
// ponytail: one entry, no `assets/*` — an asset's `src` is already a self-contained
// data URL inside the scene, so splitting them out buys nothing until base64 bloat
// or binary sharing with another app makes it worth the extract/re-inline pass.
export function projectToContainer(project: Project, base?: MonetContainer | null): MonetContainer {
  const container = base ?? createContainer(APP, "scene");
  container.manifest.app = { ...APP }; // who wrote it last
  setEntry(container, SCENE_PATH, SCENE_ROLE, new TextEncoder().encode(projectToJson(project)));
  return container;
}

/**
 * Load what Jouer understands out of ANY Monet container: the `scene` role, if
 * it carries one. A container without one is not an error — it opens as a blank
 * document whose foreign entries are all couriered back out on save. What was
 * ignored is `containerReport`'s job to say, visibly.
 */
export function projectFromContainer(container: MonetContainer): Project {
  const scene = entriesByRole(container, SCENE_ROLE)[0];
  return scene ? projectFromJson(new TextDecoder().decode(scene.data)) : createProject("Untitled");
}

/**
 * What Jouer did NOT consume, as one line for the user (rule 1) — or `null` when
 * there is nothing to say (a plain Jouer container with no foreign entries).
 */
export function containerReport(container: MonetContainer): string | null {
  const roles = [...new Set(container.manifest.entries.filter((e) => e.role !== SCENE_ROLE).map((e) => e.role))];
  const who = container.manifest.app?.name ?? "another Monet app";
  const kept = roles.length ? ` Kept ${roles.join(", ")} untouched — they are written back when you save.` : "";
  if (!entriesByRole(container, SCENE_ROLE).length) return `No Jouer scene in this ${who} document — opened blank.${kept}`;
  return roles.length ? `Opened a ${who} document.${kept}` : null;
}

const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Sorting layers: keep the string entries, dedupe, and guarantee "Default" is
 *  present (front of the list when absent) so render ordering always resolves. */
function normalizeSortingLayers(v: unknown): string[] {
  const names = arr<unknown>(v).filter((x): x is string => typeof x === "string" && x.length > 0);
  const seen = new Set<string>();
  const out = names.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  if (!out.includes("Default")) out.unshift("Default");
  return out.length ? out : ["Default"];
}

/** Tags: keep the string entries, dedupe, and guarantee "Untagged" is present
 *  (front of the list when absent). */
function normalizeTags(v: unknown): string[] {
  const names = arr<unknown>(v).filter((x): x is string => typeof x === "string" && x.length > 0);
  const seen = new Set<string>();
  const out = names.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  if (!out.includes("Untagged")) out.unshift("Untagged");
  return out.length ? out : ["Untagged"];
}

export function normalizeProject(raw: Record<string, unknown>): Project {
  const base = createProject(str(raw.name, "Untitled"));
  const scenes = arr<Record<string, unknown>>(raw.scenes).map(normalizeScene);
  const project: Project = {
    schema: SCHEMA_ID,
    name: str(raw.name, "Untitled"),
    width: num(raw.width, 960),
    height: num(raw.height, 540),
    fps: num(raw.fps, 60),
    backgroundColor: str(raw.backgroundColor, "#0c0f16"),
    physics: raw.physics === "none" ? "none" : "arcade",
    pixelArt: raw.pixelArt === true,
    physicsDebug: raw.physicsDebug === true,
    transparent: raw.transparent === true,
    scaleMode: raw.scaleMode === "fixed" || raw.scaleMode === "resize" ? raw.scaleMode : "fit",
    masterVolume: Math.min(1, Math.max(0, num(raw.masterVolume, 1))),
    sortingLayers: normalizeSortingLayers(raw.sortingLayers),
    tags: normalizeTags(raw.tags),
    assets: arr<Record<string, unknown>>(raw.assets).map(normalizeAsset),
    scenes: scenes.length ? scenes : base.scenes,
    animations: arr<Record<string, unknown>>(raw.animations).map(normalizeAnimation),
    transitions: arr<Record<string, unknown>>(raw.transitions).map(normalizeTransition),
    activeSceneId: null,
    startSceneId: null,
  };
  const active = str(raw.activeSceneId, "");
  project.activeSceneId = project.scenes.some((s) => s.id === active) ? active : project.scenes[0]?.id ?? null;
  // Unity "Scenes In Build" boot scene — kept only when it points at a real scene.
  const start = str(raw.startSceneId, "");
  project.startSceneId = project.scenes.some((s) => s.id === start) ? start : null;
  return project;
}

function normalizeAsset(raw: Record<string, unknown>): Asset {
  const kind = raw.kind === "spritesheet" ? "spritesheet" : raw.kind === "audio" ? "audio" : "image";
  return {
    id: str(raw.id, uid("asset")),
    kind,
    name: str(raw.name, "asset"),
    src: str(raw.src, ""),
    width: typeof raw.width === "number" ? raw.width : undefined,
    height: typeof raw.height === "number" ? raw.height : undefined,
    frameWidth: typeof raw.frameWidth === "number" ? raw.frameWidth : undefined,
    frameHeight: typeof raw.frameHeight === "number" ? raw.frameHeight : undefined,
    margin: typeof raw.margin === "number" ? raw.margin : undefined,
    spacing: typeof raw.spacing === "number" ? raw.spacing : undefined,
    filterMode: raw.filterMode === "nearest" || raw.filterMode === "linear" ? raw.filterMode : undefined,
  };
}

function normalizeScene(raw: Record<string, unknown>): Scene {
  const def = createScene(str(raw.name, "Scene"));
  const timelines = arr<Record<string, unknown>>(raw.timelines).map(normalizeTimeline);
  const tl = timelines.length ? timelines : def.timelines;
  const activeTl = str(raw.activeTimelineId, "");
  return {
    id: str(raw.id, def.id),
    key: str(raw.key, def.key),
    name: str(raw.name, "Scene"),
    width: num(raw.width, 960),
    height: num(raw.height, 540),
    backgroundColor: str(raw.backgroundColor, "#1a1d29"),
    gravityX: num(raw.gravityX, 0),
    gravityY: num(raw.gravityY, 0),
    cameraZoom: num(raw.cameraZoom, 1),
    cameraX: num(raw.cameraX, 0),
    cameraY: num(raw.cameraY, 0),
    cameraFollowId: typeof raw.cameraFollowId === "string" ? raw.cameraFollowId : null,
    cameraBounds: raw.cameraBounds === true,
    cameraFollowLerp: Math.min(1, Math.max(0.05, num(raw.cameraFollowLerp, 1))), // clamp to the inspector's (0,1] floor so a corrupt file can't freeze the camera
    cameraDeadzoneW: Math.max(0, num(raw.cameraDeadzoneW, 0)),
    cameraDeadzoneH: Math.max(0, num(raw.cameraDeadzoneH, 0)),
    cameraFollowOffsetX: num(raw.cameraFollowOffsetX, 0),
    cameraFollowOffsetY: num(raw.cameraFollowOffsetY, 0),
    cameraRotation: num(raw.cameraRotation, 0),
    objects: arr<Record<string, unknown>>(raw.objects).map(normalizeObject),
    timelines: tl,
    activeTimelineId: tl.some((t) => t.id === activeTl) ? activeTl : tl[0]?.id ?? null,
  };
}

function normalizeObject(raw: Record<string, unknown>): GameObject {
  const kind = ((): GameObject["kind"] => {
    const k = raw.kind;
    if (k === "sprite" || k === "image" || k === "text" || k === "rectangle" || k === "ellipse" || k === "triangle" || k === "hexagon" || k === "hexagonFlat" || k === "diamond" || k === "capsule" || k === "container") return k;
    return "rectangle";
  })();
  const t = (raw.transform ?? {}) as Record<string, unknown>;
  const o: GameObject = {
    id: str(raw.id, uid(kind)),
    kind,
    name: str(raw.name, kind),
    visible: bool(raw.visible, true),
    active: bool(raw.active, true),
    locked: bool(raw.locked, false),
    depth: num(raw.depth, 0),
    transform: defaultTransform({
      x: num(t.x, 0),
      y: num(t.y, 0),
      scaleX: num(t.scaleX, 1),
      scaleY: num(t.scaleY, 1),
      angle: num(t.angle, 0),
      originX: num(t.originX, 0.5),
      originY: num(t.originY, 0.5),
      alpha: num(t.alpha, 1),
    }),
    body: raw.body ? normalizeBody(raw.body as Record<string, unknown>) : null,
  };
  if (typeof raw.sortingLayer === "string") o.sortingLayer = raw.sortingLayer;
  if (typeof raw.tag === "string") o.tag = raw.tag;
  if (raw.blendMode === "add" || raw.blendMode === "multiply" || raw.blendMode === "screen") o.blendMode = raw.blendMode;
  if (raw.audio) o.audio = normalizeAudio(raw.audio as Record<string, unknown>);
  if (kind === "sprite" || kind === "image") {
    o.assetId = typeof raw.assetId === "string" ? raw.assetId : null;
    o.frame = (typeof raw.frame === "number" || typeof raw.frame === "string") ? raw.frame : 0;
    o.tint = typeof raw.tint === "string" ? raw.tint : null;
    o.playAnimation = typeof raw.playAnimation === "string" ? raw.playAnimation : null;
    o.flipX = bool(raw.flipX, false);
    o.flipY = bool(raw.flipY, false);
    o.drawMode = raw.drawMode === "tiled" ? "tiled" : raw.drawMode === "sliced" ? "sliced" : "simple";
    if (typeof raw.width === "number") o.width = raw.width;
    if (typeof raw.height === "number") o.height = raw.height;
    if (typeof raw.sliceLeft === "number") o.sliceLeft = raw.sliceLeft;
    if (typeof raw.sliceRight === "number") o.sliceRight = raw.sliceRight;
    if (typeof raw.sliceTop === "number") o.sliceTop = raw.sliceTop;
    if (typeof raw.sliceBottom === "number") o.sliceBottom = raw.sliceBottom;
  } else if (kind === "text") {
    o.text = str(raw.text, "Text");
    const s = (raw.style ?? {}) as Record<string, unknown>;
    o.style = defaultTextStyle({
      fontFamily: str(s.fontFamily, "Arial"),
      fontSize: num(s.fontSize, 32),
      color: str(s.color, "#ffffff"),
      fontStyle: (["normal", "bold", "italic", "bold italic"].includes(s.fontStyle as string) ? s.fontStyle : "normal") as never,
      align: (["left", "center", "right"].includes(s.align as string) ? s.align : "left") as never,
      stroke: str(s.stroke, "#000000"),
      strokeThickness: num(s.strokeThickness, 0),
      wrapWidth: num(s.wrapWidth, 0),
      lineSpacing: num(s.lineSpacing, 0),
      letterSpacing: num(s.letterSpacing, 0),
      shadowColor: str(s.shadowColor, "#000000"),
      shadowOffsetX: num(s.shadowOffsetX, 0),
      shadowOffsetY: num(s.shadowOffsetY, 0),
      shadowBlur: num(s.shadowBlur, 0),
    });
  } else if (kind === "rectangle" || kind === "ellipse" || kind === "triangle" || kind === "hexagon" || kind === "hexagonFlat" || kind === "diamond" || kind === "capsule") {
    o.width = num(raw.width, 100);
    o.height = num(raw.height, 100);
    o.fill = str(raw.fill, "#888888");
    o.stroke = str(raw.stroke, "#000000");
    o.strokeWidth = num(raw.strokeWidth, 0);
  } else if (kind === "container") {
    o.children = arr<Record<string, unknown>>(raw.children).map(normalizeObject);
  }
  return o;
}

function normalizeBody(raw: Record<string, unknown>): GameObject["body"] {
  return defaultBody({
    bodyType: raw.bodyType === "static" ? "static" : raw.bodyType === "kinematic" ? "kinematic" : "dynamic",
    shape: raw.shape === "circle" ? "circle" : "box",
    offsetX: num(raw.offsetX, 0),
    offsetY: num(raw.offsetY, 0),
    sizeW: num(raw.sizeW, 0),
    sizeH: num(raw.sizeH, 0),
    radius: num(raw.radius, 0),
    mass: num(raw.mass, 1),
    drag: num(raw.drag, 0),
    angularVelocity: num(raw.angularVelocity, 0),
    angularAcceleration: num(raw.angularAcceleration, 0),
    angularDrag: num(raw.angularDrag, 0),
    freezeRotation: bool(raw.freezeRotation, false),
    accelerationX: num(raw.accelerationX, 0),
    accelerationY: num(raw.accelerationY, 0),
    velocityX: num(raw.velocityX, 0),
    velocityY: num(raw.velocityY, 0),
    gravityY: num(raw.gravityY, 0),
    bounceX: num(raw.bounceX, 0),
    bounceY: num(raw.bounceY, 0),
    collideWorldBounds: bool(raw.collideWorldBounds, true),
    immovable: bool(raw.immovable, false),
    allowGravity: bool(raw.allowGravity, true),
  });
}

function normalizeAudio(raw: Record<string, unknown>): AudioSource {
  return defaultAudioSource({
    assetId: typeof raw.assetId === "string" ? raw.assetId : null,
    playOnAwake: bool(raw.playOnAwake, true),
    loop: bool(raw.loop, false),
    volume: num(raw.volume, 1),
    pitch: Math.max(0.1, num(raw.pitch, 1)), // floor so a corrupt/0/negative pitch can't freeze/reverse
    pan: Math.max(-1, Math.min(1, num(raw.pan, 0))),
    mute: bool(raw.mute, false),
  });
}

function normalizeTimeline(raw: Record<string, unknown>): Timeline {
  const def = createTimeline(str(raw.name, "Timeline"));
  return {
    id: str(raw.id, def.id),
    name: str(raw.name, "Timeline"),
    duration: num(raw.duration, 2),
    loop: bool(raw.loop, false),
    autoplay: bool(raw.autoplay, false),
    speed: Math.max(0.1, num(raw.speed, 1)), // floor 0.1 so a corrupt/0/negative speed can't freeze or reverse playback
    tracks: arr<Record<string, unknown>>(raw.tracks).map(normalizeTrack),
  };
}

function normalizeTrack(raw: Record<string, unknown>): AnimTrack {
  const validProps = ["x", "y", "scaleX", "scaleY", "angle", "alpha", "originX", "originY", "width", "height"];
  const property = (validProps.includes(raw.property as string) ? raw.property : "x") as AnimTrack["property"];
  return {
    id: str(raw.id, uid("trk")),
    targetId: str(raw.targetId, ""),
    property,
    keyframes: arr<Record<string, unknown>>(raw.keyframes)
      .map((k) => {
        const rawEase = str(k.ease, "sineInOut");
        return {
          id: str(k.id, uid("kf")),
          time: num(k.time, 0),
          value: num(k.value, 0),
          // Validate like every other enum in this file — an unknown/stale ease
          // id falls back to a sane default rather than silently rendering linear.
          ease: (isEaseId(rawEase) ? rawEase : "sineInOut") as AnimTrack["keyframes"][number]["ease"],
        };
      })
      .sort((a, b) => a.time - b.time),
    // Unity Timeline track mute/solo/lock — preserved only when set, so an unaffected track stays clean.
    ...(raw.muted === true ? { muted: true } : {}),
    ...(raw.solo === true ? { solo: true } : {}),
    ...(raw.locked === true ? { locked: true } : {}),
  };
}

function normalizeAnimation(raw: Record<string, unknown>): SpriteAnimation {
  return {
    id: str(raw.id, uid("anim")),
    key: str(raw.key, "anim"),
    assetId: str(raw.assetId, ""),
    frames: arr<number>(raw.frames).filter((n) => typeof n === "number"),
    frameRate: num(raw.frameRate, 10),
    repeat: num(raw.repeat, -1),
    yoyo: bool(raw.yoyo, false),
  };
}

function normalizeTransition(raw: Record<string, unknown>): Transition {
  const kind = (["fade", "slide", "wipe", "zoom", "none"].includes(raw.kind as string) ? raw.kind : "fade") as Transition["kind"];
  const trigger = (["manual", "pointerdown", "key", "timer"].includes(raw.trigger as string) ? raw.trigger : "manual") as Transition["trigger"];
  const direction = (["left", "right", "up", "down"].includes(raw.direction as string) ? raw.direction : "left") as Transition["direction"];
  return {
    id: str(raw.id, uid("tr")),
    name: str(raw.name, "Transition"),
    fromSceneId: str(raw.fromSceneId, ""),
    toSceneId: str(raw.toSceneId, ""),
    kind,
    duration: num(raw.duration, 600),
    direction,
    trigger,
    triggerKey: typeof raw.triggerKey === "string" ? raw.triggerKey : "SPACE",
    delay: num(raw.delay, 1000),
  };
}
