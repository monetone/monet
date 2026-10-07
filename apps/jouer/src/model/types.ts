// ─────────────────────────────────────────────────────────────
// types.ts — Monet Jouer's pure, framework-free document model.
//
// A Jouer project is a small game built from Scenes. Each Scene holds a tree of
// GameObjects (sprites, text, shapes, containers) and one or more property
// Timelines (keyframed tweens — the headline "animation" feature). The project
// also carries shared Assets, sprite-sheet frame Animations, and scene-to-scene
// Transitions. The whole thing serialises to a self-contained `.jouer` JSON file
// (schema `monet-jouer/v1`) and exports to runnable Phaser 4 code.
//
// Nothing in this module imports React, Phaser, or the DOM. The store clones it
// on every edit (clone-on-write undo), so keep it plain-JSON serialisable: no
// class instances, functions, Maps, or Sets.
// ─────────────────────────────────────────────────────────────

export type Id = string;

export const SCHEMA_ID = "monet-jouer/v1";

// ── Assets ────────────────────────────────────────────────────
export type AssetKind = "image" | "spritesheet" | "audio";

/** A loadable asset. `src` is a self-contained `data:` URL (so a `.jouer` file
 *  needs no sidecar files) or a project-relative path/URL. `name` is the key
 *  Phaser's loader/texture manager uses. */
export interface Asset {
  id: Id;
  kind: AssetKind;
  name: string;
  src: string;
  /** Intrinsic pixel size (placement defaults, ruler hints). */
  width?: number;
  height?: number;
  /** Spritesheet grid (kind === "spritesheet"). */
  frameWidth?: number;
  frameHeight?: number;
  /** Optional spacing/margin for the spritesheet grid. */
  margin?: number;
  spacing?: number;
  /** Texture filter mode (Unity Texture Import Settings → Filter Mode): "nearest"
   *  = Unity Point (crisp/pixelated), "linear" = Unity Bilinear (smooth). A
   *  per-texture override of the global pixelArt default; omitted ⇒ inherit it.
   *  Image/spritesheet only (audio has no texture). Maps to Phaser
   *  texture.setFilter(FilterMode.NEAREST | LINEAR). */
  filterMode?: "nearest" | "linear";
}

// ── Transform + game objects ──────────────────────────────────
export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Rotation in degrees. */
  angle: number;
  /** Origin / anchor, 0..1. */
  originX: number;
  originY: number;
  /** 0..1. */
  alpha: number;
}

export type GameObjectKind =
  | "sprite"
  | "image"
  | "text"
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "hexagon"
  | "hexagonFlat"
  | "diamond"
  | "capsule"
  | "container";

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  fontStyle: "normal" | "bold" | "italic" | "bold italic";
  align: "left" | "center" | "right";
  stroke: string;
  strokeThickness: number;
  /** Word-wrap width in px (Unity Text "Horizontal Overflow: Wrap"); 0 ⇒ no wrap
   *  (single line). Maps to Phaser Text wordWrap.width. */
  wrapWidth: number;
  /** Extra pixels between lines (Unity Text "Line Spacing"); 0 ⇒ default. Maps to
   *  Phaser Text lineSpacing. */
  lineSpacing: number;
  /** Extra pixels between glyphs (Unity TMP "Character Spacing"); may be negative;
   *  0 ⇒ default. Maps to Phaser Text letterSpacing. */
  letterSpacing: number;
  /** Drop-shadow effect color (Unity UI "Shadow" component → Effect Color). Maps
   *  to Phaser Text `shadow.color`. The shadow only renders when it has a visible
   *  offset or blur (see shadowOffsetX/Y/Blur). */
  shadowColor: string;
  /** Shadow Effect Distance X/Y in px (Unity UI "Shadow" → Effect Distance). Maps
   *  to Phaser Text `shadow.offsetX` / `shadow.offsetY`. 0,0 ⇒ no offset. */
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** Shadow softness/blur radius in px (Unity TMP underlay "Softness"). Maps to
   *  Phaser Text `shadow.blur`; 0 ⇒ a hard shadow. */
  shadowBlur: number;
}

/** Arcade-physics body (the only physics Jouer models — 2D only). */
export interface PhysicsBody {
  /** Unity's Rigidbody2D Body Type. "dynamic" = gravity + forces + collisions;
   *  "static" = never moves; "kinematic" = ignores gravity/forces and isn't
   *  pushed, but moves by its own velocity (exported as a Phaser dynamic body
   *  with immovable + allowGravity:false — the standard arcade kinematic setup). */
  bodyType: "dynamic" | "static" | "kinematic";
  /** Collider shape (Unity's BoxCollider2D vs CircleCollider2D). Omitted ⇒ "box"
   *  (Phaser's default rectangular body); "circle" exports a `setCircle` body. */
  shape?: "box" | "circle";
  /** Collider offset (Unity Collider2D Offset): shift the collider from its
   *  auto-fitted position, in px. Box ⇒ Phaser body.setOffset; circle ⇒ folded
   *  into setCircle's centring args. Omitted ⇒ 0 (no shift). Note: box uses an
   *  absolute setOffset; the export loads full (untrimmed) frames so the body's
   *  default offset is 0, making absolute == shift-from-default. */
  offsetX?: number;
  offsetY?: number;
  /** Explicit box-collider Size in px (Unity BoxCollider2D.size): override the
   *  collider's auto-fit to the object so the physics hitbox can be larger or
   *  smaller than the visual. Both axes apply together (Unity Size is a Vector2);
   *  0/omitted on either ⇒ auto-fit (Phaser's default body size). Box shape only;
   *  maps to Phaser body.setSize, emitted before setOffset. */
  sizeW?: number;
  sizeH?: number;
  /** Explicit circle-collider Radius in px (Unity CircleCollider2D.radius):
   *  override the auto-fitted circle (largest that fits the box). 0/omitted ⇒
   *  auto-fit. Circle shape only; drives Phaser body.setCircle's radius, kept
   *  centred and with the Collider Offset folded in. */
  radius?: number;
  /** Rigidbody mass (Unity parity); how much force is needed to move it. Omitted
   *  ⇒ 1 (Phaser's default). */
  mass?: number;
  /** Linear drag (Unity parity); friction that slows the body's motion. Omitted
   *  ⇒ 0 (no drag). */
  drag?: number;
  /** Initial angular velocity in degrees/second (Unity parity); the body spins
   *  at this rate. Omitted ⇒ 0. May be negative (clockwise). */
  angularVelocity?: number;
  /** Continuous angular acceleration in degrees/s² (Unity ConstantForce2D torque):
   *  a constant rotational force applied every physics step to a DYNAMIC body,
   *  distinct from the one-off initial angularVelocity. Omitted ⇒ 0. May be
   *  negative. Kinematic/static bodies ignore it. */
  angularAcceleration?: number;
  /** Angular drag (Unity parity); slows the body's rotation over time. Omitted
   *  ⇒ 0 (no angular drag). */
  angularDrag?: number;
  /** Freeze rotation (Unity's "Freeze Rotation Z" constraint); when true the
   *  body never rotates. Omitted ⇒ false. */
  freezeRotation?: boolean;
  /** Continuous acceleration in px/s² (Unity ConstantForce2D / Rigidbody2D
   *  forces): applied every physics step to a DYNAMIC body, distinct from the
   *  one-off initial velocity. Omitted ⇒ 0. Kinematic/static bodies ignore it. */
  accelerationX?: number;
  accelerationY?: number;
  velocityX: number;
  velocityY: number;
  gravityY: number;
  bounceX: number;
  bounceY: number;
  collideWorldBounds: boolean;
  immovable: boolean;
  allowGravity: boolean;
}

export interface GameObject {
  id: Id;
  kind: GameObjectKind;
  name: string;
  /** Scene-view render toggle (Unity's Scene Visibility "eye"): editor-only-ish —
   *  hides the node but the object still simulates physics and does not cascade. */
  visible: boolean;
  /** Active state (Unity's GameObject.SetActive / the inspector + hierarchy
   *  checkbox). An inactive object — and its whole subtree (activeInHierarchy
   *  cascade) — is excluded from the running/exported game: not rendered and no
   *  physics body. Distinct from `visible`. Default true. */
  active: boolean;
  locked: boolean;
  transform: Transform;
  /** Order in layer — z-order *within* the object's sorting layer (higher =
   *  front). */
  depth: number;
  /** 2D sorting layer (Unity parity). Objects on a later project sorting layer
   *  always render in front of earlier ones, regardless of `depth`. Omitted ⇒
   *  the "Default" layer. */
  sortingLayer?: string;
  /** Identification tag (Unity parity); one per object. Omitted ⇒ "Untagged".
   *  Exported as Phaser object data so the runnable game can query by tag. */
  tag?: string;
  /** Render blend mode (Unity's SpriteRenderer material blend, 2D subset). Maps
   *  to Phaser setBlendMode. Any renderable kind; omitted ⇒ "normal" (alpha). */
  blendMode?: "normal" | "add" | "multiply" | "screen";

  // Textured (sprite / image).
  assetId?: Id | null;
  /** Spritesheet frame index/name for the static display. */
  frame?: number | string;
  /** Sprite-sheet animation key to autoplay on start (sprite only). */
  playAnimation?: string | null;
  tint?: string | null;
  /** SpriteRenderer Draw Mode (Unity parity). "simple" (default/omitted) draws
   *  the texture once; "tiled" repeats it across width×height (the Size) as a
   *  Phaser TileSprite; "sliced" 9-slices it (fixed corners, stretched edges) as
   *  a Phaser NineSlice. Sprite/image only. */
  drawMode?: "simple" | "tiled" | "sliced";
  /** 9-slice border insets in px (Unity's sprite border), used when drawMode is
   *  "sliced". Corners inside these insets stay fixed; the rest stretches to the
   *  Size. Omitted ⇒ 0. */
  sliceLeft?: number;
  sliceRight?: number;
  sliceTop?: number;
  sliceBottom?: number;
  /** SpriteRenderer Flip X / Flip Y (Unity parity): mirror the texture render on
   *  the axis WITHOUT changing the transform — distinct from the scale-based
   *  Flip Horizontal/Vertical (see model/flip.ts). Sprite/image only; omitted ⇒
   *  not flipped. */
  flipX?: boolean;
  flipY?: boolean;

  // Text.
  text?: string;
  style?: TextStyle;

  // Shapes (rectangle / ellipse / triangle / hexagon / diamond / capsule) and explicit-size sprites.
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;

  // Physics.
  body?: PhysicsBody | null;

  // Audio (Unity AudioSource). Any kind may carry one. Omitted ⇒ no sound.
  audio?: AudioSource | null;

  // Container children (recursive).
  children?: GameObject[];
}

/** A sound attached to an object (Unity AudioSource, 2D subset). Play/export
 *  only — the editor never previews audio while scrubbing. */
export interface AudioSource {
  /** The audio Asset to play. Omitted/null ⇒ nothing plays. */
  assetId: Id | null;
  /** Unity "Play On Awake": start the clip when the scene starts. */
  playOnAwake: boolean;
  /** Loop the clip. */
  loop: boolean;
  /** Playback volume, 0..1 (Unity default 1). */
  volume: number;
  /** Pitch / playback-rate multiplier (Unity AudioSource Pitch; Phaser sound
   *  `rate`). 1 = normal, higher = faster+higher-pitched. Default 1. */
  pitch: number;
  /** Stereo pan (Unity AudioSource Stereo Pan; Phaser sound `pan`): -1 = full
   *  left, 0 = centre, +1 = full right. Default 0. */
  pan: number;
  /** Mute (Unity AudioSource Mute; Phaser sound `mute`): silences the source
   *  while preserving its volume. Default false. */
  mute: boolean;
}

// ── Animation timelines (keyframed property tracks) ───────────
/** Numeric, tween-able object properties a track can drive. */
export type TrackProperty =
  | "x"
  | "y"
  | "scaleX"
  | "scaleY"
  | "angle"
  | "alpha"
  | "originX"
  | "originY"
  | "width"
  | "height";

export interface Keyframe {
  id: Id;
  /** Seconds from the start of the timeline. */
  time: number;
  value: number;
  /** Easing applied on the segment leaving this keyframe. */
  ease: EaseId;
}

export interface AnimTrack {
  id: Id;
  /** GameObject this track drives (by id, anywhere in the scene tree). */
  targetId: Id;
  property: TrackProperty;
  /** Keyframes, kept sorted ascending by `time`. */
  keyframes: Keyframe[];
  /** Muted (Unity Timeline track mute): when true the track keeps its keyframes
   *  but drives nothing — skipped by the editor preview, the player and the
   *  export. Omitted ⇒ active. */
  muted?: boolean;
  /** Solo (Unity Timeline track solo): when any track in the timeline is soloed,
   *  only soloed (and non-muted) tracks drive their targets; the rest are
   *  silenced. Omitted ⇒ not soloed. */
  solo?: boolean;
  /** Locked (Unity Timeline track lock): a locked track still plays/exports but
   *  cannot be EDITED — no adding/changing/deleting its keyframes, no removing
   *  the track, and record mode won't auto-key it. Omitted ⇒ unlocked. */
  locked?: boolean;
}

/** A keyframed animation clip scoped to a Scene. Drives object properties over
 *  `duration` seconds; exports to a coordinated set of Phaser tweens. */
export interface Timeline {
  id: Id;
  name: string;
  duration: number;
  loop: boolean;
  autoplay: boolean;
  /** Playback speed multiplier for the played/exported game (Unity Animator speed;
   *  Phaser TweenChain timeScale). 1 = normal, >1 faster, <1 slower. The editor
   *  scrubs all timelines on one master playhead at real time, so this applies to
   *  the played/exported game only. */
  speed: number;
  tracks: AnimTrack[];
}

// ── Sprite-sheet frame animations (Phaser anims) ──────────────
export interface SpriteAnimation {
  id: Id;
  key: string;
  assetId: Id;
  frames: number[];
  frameRate: number;
  /** -1 = loop forever. */
  repeat: number;
  yoyo: boolean;
}

// ── Scene transitions ─────────────────────────────────────────
export type TransitionKind = "fade" | "slide" | "wipe" | "zoom" | "none";
export type TransitionTrigger = "manual" | "pointerdown" | "key" | "timer";

export interface Transition {
  id: Id;
  name: string;
  fromSceneId: Id;
  toSceneId: Id;
  kind: TransitionKind;
  /** Milliseconds. */
  duration: number;
  direction: "left" | "right" | "up" | "down";
  trigger: TransitionTrigger;
  /** Key name for the "key" trigger (e.g. "SPACE"). */
  triggerKey?: string;
  /** Delay in ms for the "timer" trigger. */
  delay?: number;
}

// ── Scene + project ───────────────────────────────────────────
export interface Scene {
  id: Id;
  key: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  /** Arcade-physics gravity vector for this scene (px/s²), Unity Physics2D.gravity
   *  parity. X = horizontal pull (sideways gravity / wind), Y = vertical pull.
   *  0,0 = zero-G. Mapped to Phaser `this.physics.world.gravity.x` / `.y`. */
  gravityX: number;
  gravityY: number;
  /** Main-camera zoom for the played/exported game (Unity Camera zoom; an
   *  orthographic-size analogue). 1 = no zoom; >1 zooms in, <1 zooms out. The
   *  editor viewport has its own zoom and is unaffected. */
  cameraZoom: number;
  /** Main-camera scroll/position for the played/exported game (Unity Camera
   *  position; Phaser camera scroll). 0,0 = default view. Editor viewport has its
   *  own camera and is unaffected. */
  cameraX: number;
  cameraY: number;
  /** Object the main camera follows in the played/exported game (Unity Cinemachine
   *  Virtual Camera "Follow"; Phaser camera.startFollow). null = no follow. Editor
   *  viewport has its own camera and is unaffected. */
  cameraFollowId: Id | null;
  /** Confine the played/exported main camera to the scene rect (Unity Cinemachine
   *  Confiner 2D; Phaser camera.setBounds). Keeps a following camera inside the
   *  level. false = unbounded. Editor viewport has its own camera and is unaffected. */
  cameraBounds: boolean;
  /** Follow smoothing for the played/exported main camera (Unity Cinemachine Follow
   *  damping; Phaser startFollow lerp). 1 = instant snap; lower = smoother/laggier.
   *  Only meaningful when cameraFollowId is set. Editor viewport is unaffected. */
  cameraFollowLerp: number;
  /** Follow dead-zone size in px (Unity Cinemachine Dead Zone; Phaser
   *  camera.setDeadzone): the follow target moves freely within this centred
   *  rect before the camera pans. 0 = none. Only meaningful when following.
   *  Played/exported game only — the editor viewport is unaffected. */
  cameraDeadzoneW: number;
  cameraDeadzoneH: number;
  /** Follow offset in px (Unity Cinemachine Transposer "Follow Offset" /
   *  Framing Transposer "Tracked Object Offset"; Phaser startFollow offsetX/Y):
   *  displaces the camera from its follow target — e.g. lead ahead of motion or
   *  keep the target off-centre. 0,0 = centred. Only meaningful when following.
   *  Played/exported game only — the editor viewport is unaffected. */
  cameraFollowOffsetX: number;
  cameraFollowOffsetY: number;
  /** Main-camera roll in degrees for the played/exported game (Unity Cinemachine
   *  Lens "Dutch"; a deliberate camera tilt/Dutch angle). 0 = upright. Mapped to
   *  Phaser camera.setRotation (radians) — converted from these degrees. The
   *  editor viewport has its own camera and is unaffected. */
  cameraRotation: number;
  objects: GameObject[];
  timelines: Timeline[];
  activeTimelineId: Id | null;
}

/** Game presentation scale mode (Unity Resolution & Presentation / Game View
 *  aspect parity → Phaser Scale Manager mode). "fit" letterboxes the fixed base
 *  resolution to the window preserving aspect (centered); "fixed" renders at the
 *  exact base resolution; "resize" expands the canvas to fill the window. */
export type ScaleMode = "fit" | "fixed" | "resize";

export interface Project {
  schema: string;
  name: string;
  /** Base game resolution. */
  width: number;
  height: number;
  /** Frame rate used for the timeline's frame display + frame snapping. */
  fps: number;
  backgroundColor: string;
  physics: "none" | "arcade";
  /** Pixel-art rendering mode (Unity 2D Pixel Perfect Camera parity). When true
   *  the played/exported game renders with nearest-neighbour texture filtering
   *  and whole-pixel snapping (Phaser GameConfig `pixelArt`); false keeps smooth
   *  antialiased rendering. Applies to the played/exported game only — the editor
   *  design surface is unaffected, like Camera Zoom/Scroll. */
  pixelArt: boolean;
  /** Physics debug draw (Unity Physics 2D Debugger / collider gizmos). When true
   *  the played/exported arcade game draws every body's outline + velocity vector
   *  (Phaser GameConfig `physics.arcade.debug`); false hides them. Played/exported
   *  game only, and only meaningful when physics is "arcade". Default false. */
  physicsDebug: boolean;
  /** Transparent canvas (Unity Camera transparent background / Clear Flags). When
   *  true the played/exported game's canvas is see-through (Phaser GameConfig
   *  `transparent: true`) and every scene skips painting a camera background, so
   *  whatever is behind the canvas (the host page) shows through — for embedding
   *  the game over other content. Played/exported game only; the editor design
   *  surface is unaffected. Default false (opaque canvas). */
  transparent: boolean;
  /** Game presentation scale mode (Unity Resolution & Presentation / Game View
   *  aspect parity). Drives the Phaser Scale Manager in the played/exported game:
   *  "fit" letterboxes the base resolution to the window, "fixed" renders at the
   *  exact base resolution, "resize" fills the window. Played/exported game only —
   *  the editor design surface (PhaserStage) is unaffected. Default "fit". */
  scaleMode: ScaleMode;
  /** Global audio master volume (Unity AudioListener.volume / audio master),
   *  0..1, that scales every sound the game plays. Sets the Phaser global sound
   *  manager volume in the played/exported game. EXPORT-ONLY — the editor preview
   *  runs with noAudio (silent), so this only affects the exported standalone
   *  game (like Start Scene's Play-vs-Build split). Default 1 (full volume). */
  masterVolume: number;
  /** Ordered 2D sorting layers (Unity parity); index 0 renders back-most. Always
   *  contains "Default". */
  sortingLayers: string[];
  /** Available object tags (Unity parity). Always contains "Untagged". */
  tags: string[];
  assets: Asset[];
  scenes: Scene[];
  animations: SpriteAnimation[];
  transitions: Transition[];
  activeSceneId: Id | null;
  /** The scene the EXPORTED game boots into (Unity "Scenes In Build" first entry
   *  / Set as Start Scene). Decoupled from the edited active scene: omitted/null
   *  ⇒ the exported game falls back to the active scene. Export-only — the editor
   *  preview always plays the active scene (Unity Play-vs-Build). */
  startSceneId?: Id | null;
}

// ── Easing ids (defined with their samplers in ease.ts) ───────
export type EaseId =
  | "linear"
  | "hold"
  | "sineIn"
  | "sineOut"
  | "sineInOut"
  | "quadIn"
  | "quadOut"
  | "quadInOut"
  | "cubicIn"
  | "cubicOut"
  | "cubicInOut"
  | "quartInOut"
  | "expoOut"
  | "backIn"
  | "backOut"
  | "backInOut"
  | "elasticOut"
  | "bounceOut";
