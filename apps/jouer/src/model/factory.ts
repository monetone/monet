// ─────────────────────────────────────────────────────────────
// factory.ts — constructors for the document model. Every factory returns a
// fresh, fully-defaulted, JSON-serialisable value with a unique id. UI code and
// commands build new model nodes exclusively through these so defaults stay in
// one place.
// ─────────────────────────────────────────────────────────────

import type {
  Asset,
  AssetKind,
  AudioSource,
  GameObject,
  GameObjectKind,
  Keyframe,
  PhysicsBody,
  Project,
  Scene,
  SpriteAnimation,
  TextStyle,
  Timeline,
  AnimTrack,
  TrackProperty,
  Transform,
  Transition,
  TransitionKind,
} from "./types";
import { SCHEMA_ID } from "./types";

/** Short, unique, sortable-enough id. Uses crypto.randomUUID where available
 *  (browser + node ≥ 19) and falls back to a counter for exotic runtimes. */
let _counter = 0;
export function uid(prefix = "o"): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const rand = g.crypto?.randomUUID ? g.crypto.randomUUID().slice(0, 8) : (_counter++).toString(36).padStart(4, "0");
  return `${prefix}_${rand}`;
}

export function defaultTransform(over: Partial<Transform> = {}): Transform {
  return {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    angle: 0,
    originX: 0.5,
    originY: 0.5,
    alpha: 1,
    ...over,
  };
}

export function defaultTextStyle(over: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: "Arial",
    fontSize: 32,
    color: "#ffffff",
    fontStyle: "normal",
    align: "left",
    stroke: "#000000",
    strokeThickness: 0,
    wrapWidth: 0,
    lineSpacing: 0,
    letterSpacing: 0,
    shadowColor: "#000000",
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0,
    ...over,
  };
}

export function defaultBody(over: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    bodyType: "dynamic",
    shape: "box",
    mass: 1,
    drag: 0,
    angularVelocity: 0,
    angularDrag: 0,
    freezeRotation: false,
    velocityX: 0,
    velocityY: 0,
    gravityY: 0,
    bounceX: 0,
    bounceY: 0,
    collideWorldBounds: true,
    immovable: false,
    allowGravity: true,
    ...over,
  };
}

export function defaultAudioSource(over: Partial<AudioSource> = {}): AudioSource {
  return {
    assetId: null,
    playOnAwake: true,
    loop: false,
    volume: 1,
    pitch: 1,
    pan: 0,
    mute: false,
    ...over,
  };
}

export function createAsset(kind: AssetKind, name: string, src: string, over: Partial<Asset> = {}): Asset {
  return { id: uid("asset"), kind, name, src, ...over };
}

/** Build a game object of the given kind with kind-appropriate defaults. */
export function createGameObject(kind: GameObjectKind, over: Partial<GameObject> = {}): GameObject {
  const base: GameObject = {
    id: uid(kind),
    kind,
    name: defaultName(kind),
    visible: true,
    active: true,
    locked: false,
    transform: defaultTransform(over.transform),
    depth: 0,
    body: null,
  };
  switch (kind) {
    case "sprite":
    case "image":
      base.assetId = over.assetId ?? null;
      base.frame = over.frame ?? 0;
      base.tint = over.tint ?? null;
      base.flipX = over.flipX ?? false;
      base.flipY = over.flipY ?? false;
      base.drawMode = over.drawMode ?? "simple";
      if (over.width != null) base.width = over.width;
      if (over.height != null) base.height = over.height;
      if (over.sliceLeft != null) base.sliceLeft = over.sliceLeft;
      if (over.sliceRight != null) base.sliceRight = over.sliceRight;
      if (over.sliceTop != null) base.sliceTop = over.sliceTop;
      if (over.sliceBottom != null) base.sliceBottom = over.sliceBottom;
      break;
    case "text":
      base.text = over.text ?? "Text";
      base.style = defaultTextStyle(over.style);
      break;
    case "rectangle":
      base.width = over.width ?? 120;
      base.height = over.height ?? 80;
      base.fill = over.fill ?? "#4ade80";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "ellipse":
      base.width = over.width ?? 100;
      base.height = over.height ?? 100;
      base.fill = over.fill ?? "#60a5fa";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "triangle":
      base.width = over.width ?? 100;
      base.height = over.height ?? 100;
      base.fill = over.fill ?? "#f472b6";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "hexagon":
    case "hexagonFlat":
      base.width = over.width ?? 100;
      base.height = over.height ?? 100;
      base.fill = over.fill ?? "#fbbf24";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "diamond":
      base.width = over.width ?? 100;
      base.height = over.height ?? 100;
      base.fill = over.fill ?? "#a78bfa";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "capsule":
      base.width = over.width ?? 100;
      base.height = over.height ?? 100;
      base.fill = over.fill ?? "#2dd4bf";
      base.stroke = over.stroke ?? "#0c0f16";
      base.strokeWidth = over.strokeWidth ?? 0;
      break;
    case "container":
      base.children = over.children ?? [];
      break;
  }
  // Copy through any remaining explicit overrides (name, depth, visible, …).
  return {
    ...base,
    ...over,
    transform: base.transform,
    style: base.style,
  };
}

function defaultName(kind: GameObjectKind): string {
  const n: Record<GameObjectKind, string> = {
    sprite: "Sprite",
    image: "Image",
    text: "Text",
    rectangle: "Rectangle",
    ellipse: "Ellipse",
    triangle: "Triangle",
    hexagon: "Hexagon",
    hexagonFlat: "Hexagon Flat",
    diamond: "Diamond",
    capsule: "Capsule",
    container: "Container",
  };
  return n[kind];
}

export function createKeyframe(time: number, value: number, over: Partial<Keyframe> = {}): Keyframe {
  return { id: uid("kf"), time, value, ease: over.ease ?? "sineInOut", ...over };
}

export function createTrack(targetId: string, property: TrackProperty, keyframes: Keyframe[] = []): AnimTrack {
  return { id: uid("trk"), targetId, property, keyframes };
}

export function createTimeline(name = "Timeline", over: Partial<Timeline> = {}): Timeline {
  return {
    id: uid("tl"),
    name,
    duration: 2,
    loop: false,
    autoplay: false,
    speed: 1,
    tracks: [],
    ...over,
  };
}

export function createSpriteAnimation(key: string, assetId: string, over: Partial<SpriteAnimation> = {}): SpriteAnimation {
  return {
    id: uid("anim"),
    key,
    assetId,
    frames: [],
    frameRate: 10,
    repeat: -1,
    yoyo: false,
    ...over,
  };
}

export function createTransition(fromSceneId: string, toSceneId: string, over: Partial<Transition> = {}): Transition {
  const kind: TransitionKind = over.kind ?? "fade";
  return {
    id: uid("tr"),
    name: over.name ?? "Transition",
    fromSceneId,
    toSceneId,
    kind,
    duration: 600,
    direction: "left",
    trigger: "manual",
    triggerKey: "SPACE",
    delay: 1000,
    ...over,
  };
}

export function createScene(name = "Scene", over: Partial<Scene> = {}): Scene {
  const tl = createTimeline("Main");
  return {
    id: uid("scene"),
    key: over.key ?? slugKey(name),
    name,
    width: over.width ?? 960,
    height: over.height ?? 540,
    backgroundColor: over.backgroundColor ?? "#1a1d29",
    gravityX: over.gravityX ?? 0,
    gravityY: over.gravityY ?? 0,
    cameraZoom: over.cameraZoom ?? 1,
    cameraX: over.cameraX ?? 0,
    cameraY: over.cameraY ?? 0,
    cameraFollowId: over.cameraFollowId ?? null,
    cameraBounds: over.cameraBounds ?? false,
    cameraFollowLerp: over.cameraFollowLerp ?? 1,
    cameraDeadzoneW: over.cameraDeadzoneW ?? 0,
    cameraDeadzoneH: over.cameraDeadzoneH ?? 0,
    cameraFollowOffsetX: over.cameraFollowOffsetX ?? 0,
    cameraFollowOffsetY: over.cameraFollowOffsetY ?? 0,
    cameraRotation: over.cameraRotation ?? 0,
    objects: over.objects ?? [],
    timelines: over.timelines ?? [tl],
    activeTimelineId: over.activeTimelineId ?? (over.timelines ? over.timelines[0]?.id ?? null : tl.id),
  };
}

/** A Phaser-safe scene/animation key: alnum + underscore, never blank. */
export function slugKey(name: string): string {
  const s = name.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s || "Scene";
}

export function createProject(name = "Untitled", over: Partial<Project> = {}): Project {
  const scene = createScene("Scene 1", { width: over.width ?? 960, height: over.height ?? 540 });
  return {
    schema: SCHEMA_ID,
    name,
    width: 960,
    height: 540,
    fps: 60,
    backgroundColor: "#0c0f16",
    physics: "arcade",
    pixelArt: false,
    physicsDebug: false,
    transparent: false,
    scaleMode: "fit",
    masterVolume: 1,
    sortingLayers: ["Default"],
    tags: ["Untagged", "Player", "Enemy"],
    assets: [],
    scenes: [scene],
    animations: [],
    transitions: [],
    activeSceneId: scene.id,
    startSceneId: null,
    ...over,
  };
}
