export interface ActionMeta {
  id: number;
  name: string;
  stepCount: number;
  favorite: boolean;
  createdAt: number;
  lastPlayedAt: number | null;
  /** Set (folder) the action lives in. ponytail: a set is a group-by label on
   *  the flat action list, not a first-class node — upgrade to a draggable
   *  folder tree if sets ever need their own rename/reorder/favorite. */
  set: string;
}

export const DEFAULT_ACTION_SET = "Default Actions";

export function defaultActionName(existing: ActionMeta[], fallback = "Action"): string {
  const used = new Set(existing.map((a) => a.name.trim().toLowerCase()));
  for (let n = existing.length + 1; ; n++) {
    const name = `${fallback} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

export function createActionMeta(
  id: number,
  name: string,
  stepCount: number,
  now = Date.now(),
  set = DEFAULT_ACTION_SET,
): ActionMeta {
  const clean = name.trim() || `Action ${id}`;
  const cleanSet = set.trim() || DEFAULT_ACTION_SET;
  return { id, name: clean, stepCount: Math.max(0, Math.round(stepCount)), favorite: false, createdAt: now, lastPlayedAt: null, set: cleanSet };
}

export function renameActionMeta(actions: ActionMeta[], id: number, name: string): ActionMeta[] {
  const clean = name.trim();
  if (!clean) return actions;
  // A second action with the same name used to steal every reference that
  // resolved by name. Keep the requested name when it is free; otherwise
  // take the next "Name N", the same rule import already uses.
  const others = actions.filter((a) => a.id !== id);
  const unique = others.some((a) => a.name.trim().toLowerCase() === clean.toLowerCase())
    ? defaultActionName(others, clean)
    : clean;
  return actions.map((a) => (a.id === id ? { ...a, name: unique } : a));
}

export function toggleActionFavorite(actions: ActionMeta[], id: number): ActionMeta[] {
  return actions.map((a) => (a.id === id ? { ...a, favorite: !a.favorite } : a));
}

export function markActionPlayed(actions: ActionMeta[], id: number, now = Date.now()): ActionMeta[] {
  return actions.map((a) => (a.id === id ? { ...a, lastPlayedAt: now } : a));
}

/** A command-line `--play-action "Set/Name"` (or a name only one action has),
 *  case-insensitively. Comparing the whole `set/name` string keeps a "/" inside
 *  a set or an action name working; anything ambiguous resolves to null. */
export function findActionRef(actions: ActionMeta[], ref: string): ActionMeta | null {
  const wanted = ref.trim().toLowerCase();
  const exact = actions.filter((a) => `${a.set}/${a.name}`.toLowerCase() === wanted);
  const matches = exact.length ? exact : actions.filter((a) => a.name.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

export function filterActionMetas(actions: ActionMeta[], query = "", favoritesOnly = false): ActionMeta[] {
  const q = query.trim().toLowerCase();
  return actions.filter((a) => {
    if (favoritesOnly && !a.favorite) return false;
    if (!q) return true;
    return a.name.toLowerCase().includes(q) || a.set.toLowerCase().includes(q) || String(a.stepCount).includes(q);
  });
}

// ── Step-tree helpers (Photoshop's sets → actions → steps model) ─────────────
/** One row of a saved action's step list as the UI consumes it. */
export interface ActionStepInfo {
  index: number;
  label: string;
  /** Compact args preview for tooltips; empty for volatile steps. */
  args: string;
  enabled: boolean;
  /** Photoshop's modal toggle: pause and confirm this step during playback. */
  dialog: boolean;
  /** True when the step has no serializable descriptor (in-session only). */
  volatile: boolean;
}

/** Pseudo-op for Photoshop's Insert Stop: pauses playback with a message.
 *  Handled inline by playNamed — never dispatched through visionOps, but
 *  always accepted by parseActionsFile so stop steps persist and import. */
export const STOP_OP = "action.stop";

/** Normalize a stop step's [message, allowContinue] args (untrusted on import). */
export function parseStopArgs(args: unknown[]): { message: string; allowContinue: boolean } {
  const message = typeof args[0] === "string" && args[0].trim() ? args[0] : "Stop";
  return { message, allowContinue: args[1] === true };
}

/** Pseudo-op for Photoshop's Insert Conditional: test the document/active layer
 *  and play one saved action if it holds, another if it doesn't. Like STOP_OP it
 *  is handled inline by playNamed, never dispatched through visionOps, and is
 *  always accepted by parseActionsFile so branches survive export/import. */
export const IF_OP = "action.if";

/** The document/layer tests Insert Conditional offers, in panel order. Keys are
 *  the persisted wire values — renaming one breaks saved actions. */
export const ACTION_CONDITIONS = [
  "documentOpen", "documentLandscape", "documentPortrait", "documentSquare",
  "documentRgb", "documentGrayscale", "documentDirty", "hasSelection",
  "layerVisible", "layerLocked", "layerHasMask",
  "layerIsPixel", "layerIsText", "layerIsAdjustment", "layerIsShape", "layerIsSmartObject",
] as const;
export type ActionCondition = (typeof ACTION_CONDITIONS)[number];

/** The flat slice of app state a condition can see. Kept primitive so the
 *  evaluator stays pure and testable without the store. */
export interface ActionConditionContext {
  documentOpen: boolean;
  width: number;
  height: number;
  mode: number; // AppSnapshot.mode — 0 RGB, 1 Grayscale, 2 CMYK, 3 Lab, 4 Multichannel
  dirty: boolean;
  hasSelection: boolean;
  layerVisible: boolean;
  layerLocked: boolean;
  layerHasMask: boolean;
  layerKind: number; // engineContracts LAYER_KIND; -1 when there is no active layer
}

/** Evaluate one condition. An unknown key is false — an imported action naming a
 *  condition this build doesn't have takes its else branch rather than throwing. */
export function evalActionCondition(condition: string, ctx: ActionConditionContext): boolean {
  switch (condition) {
    case "documentOpen": return ctx.documentOpen;
    case "documentLandscape": return ctx.documentOpen && ctx.width > ctx.height;
    case "documentPortrait": return ctx.documentOpen && ctx.height > ctx.width;
    case "documentSquare": return ctx.documentOpen && ctx.width === ctx.height && ctx.width > 0;
    case "documentRgb": return ctx.documentOpen && ctx.mode === 0;
    case "documentGrayscale": return ctx.documentOpen && ctx.mode === 1;
    case "documentDirty": return ctx.documentOpen && ctx.dirty;
    case "hasSelection": return ctx.hasSelection;
    case "layerVisible": return ctx.layerKind >= 0 && ctx.layerVisible;
    case "layerLocked": return ctx.layerKind >= 0 && ctx.layerLocked;
    case "layerHasMask": return ctx.layerKind >= 0 && ctx.layerHasMask;
    case "layerIsPixel": return ctx.layerKind === 0;
    case "layerIsAdjustment": return ctx.layerKind === 1;
    case "layerIsText": return ctx.layerKind === 2;
    case "layerIsShape": return ctx.layerKind === 3;
    case "layerIsSmartObject": return ctx.layerKind === 7;
    default: return false;
  }
}

/** Normalize a conditional step's [condition, thenAction, elseAction] args
 *  (untrusted on import). Branches are action NAMES, not ids, so they survive
 *  export/import into another session where ids differ; "" means "do nothing". */
export function parseIfArgs(args: unknown[]): { condition: string; thenAction: string; elseAction: string } {
  const name = (v: unknown): string =>
    typeof v === "string" && v.trim().length <= MAX_ACTION_NAME_CHARS ? v.trim() : "";
  return {
    condition: typeof args[0] === "string" ? args[0] : "",
    thenAction: name(args[1]),
    elseAction: name(args[2]),
  };
}

/** Which branch a conditional step takes: the name of the action to play, or ""
 *  for none (unset branch, or a condition this build doesn't know). */
export function ifBranchTarget(args: unknown[], ctx: ActionConditionContext): string {
  const { condition, thenAction, elseAction } = parseIfArgs(args);
  return evalActionCondition(condition, ctx) ? thenAction : elseAction;
}

/** Recursion ceiling for conditional branches: an action whose branch plays an
 *  action that branches back would otherwise loop forever. */
export const MAX_ACTION_PLAY_DEPTH = 8;

/** Photoshop's Playback Options. "accelerated" runs straight through;
 *  "stepByStep" confirms every step, like flagging them all modal.
 *  Playback is async (a desktop pause waits on the native dialog) and batch
 *  callers await it before writing output.
 *  ponytail: no "Pause For N Seconds" — add it as one more awaited branch in
 *  runActionSteps if authoring needs it. */
export const PLAYBACK_MODES = ["accelerated", "stepByStep"] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

/** Human label for a recorded op path: "adj.brightnessContrast" → "Brightness Contrast". */
export function stepLabel(path: string | null): string {
  if (!path) return "(non-scriptable)";
  const leaf = path.split(".").pop() || path;
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Compact one-line preview of a step's args (typed arrays — live or still
 *  {$ta,b64}-encoded — collapse to a "[f32]" placeholder). */
export function stepArgsPreview(args: unknown[], max = 120): string {
  let s: string;
  try {
    s = JSON.stringify(args, (_k, v: unknown) => {
      const tag = taTag(v);
      if (tag) return `[${tag}]`;
      return isTaEnc(v) ? `[${v.$ta}]` : v;
    }) ?? "[]";
  } catch { s = "[…]"; }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Move items[from] to position `to`, immutably; out-of-range or no-op moves
 *  return the input array unchanged. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ── Portable action serialization (persistence + .mvactions export/import) ────
// A recorded step's replayable descriptor: a curated op path (as exposed by
// visionOps()) plus the args it was called with. Args may include typed arrays
// (curves/LUT/channel-mixer), which JSON can't hold — they're wrapped as {$ta,b64}.
export type ActionOp = [path: string, args: unknown[]];
// `set`, `disabled` (indices of switched-off steps) and `dialogs` (indices of
// modal-toggled steps) are optional so pre-step-model files keep parsing; steps
// stay bare [path,args] tuples on the wire.
export interface PortableAction { name: string; favorite: boolean; createdAt: number; steps: ActionOp[]; set?: string; disabled?: number[]; dialogs?: number[]; }
export interface ActionsFile { format: "mvactions"; version: 1; app: string; exportedAt: number; actions: PortableAction[]; }

export const MAX_ACTIONS_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORTED_ACTIONS = 256;
export const MAX_ACTION_STEPS = 256;
export const MAX_ACTION_TOTAL_STEPS = 4096;
export const MAX_ACTION_NAME_CHARS = 256;
export const MAX_ACTION_VALUE_DEPTH = 32;
export const MAX_ACTION_VALUE_NODES = 16_384;
export const MAX_ACTION_CONTAINER_ITEMS = 4096;
export const MAX_ACTION_STRING_CHARS = 1024 * 1024;
export const MAX_ACTION_TYPED_ARRAY_BYTES = 1024 * 1024;

type TaTag = "u8" | "f32" | "i32";
interface TaEnc { $ta: TaTag; b64: string; }
const TA_CTORS = { u8: Uint8Array, f32: Float32Array, i32: Int32Array } as const;

function taTag(v: unknown): TaTag | null {
  if (v instanceof Uint8Array) return "u8";
  if (v instanceof Float32Array) return "f32";
  if (v instanceof Int32Array) return "i32";
  return null;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}
function isTaEnc(v: unknown): v is TaEnc {
  return isPlainObject(v)
    && (v.$ta === "u8" || v.$ta === "f32" || v.$ta === "i32")
    && typeof v.b64 === "string";
}

interface SerializableBudget {
  nodes: number;
  stringChars: number;
  typedArrayBytes: number;
}

function encodedByteLength(value: TaEnc): number | null {
  const { b64 } = value;
  if (b64.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) return null;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  const byteLength = b64.length / 4 * 3 - padding;
  const alignment = value.$ta === "u8" ? 1 : 4;
  return byteLength <= MAX_ACTION_TYPED_ARRAY_BYTES && byteLength % alignment === 0 ? byteLength : null;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function encodeTa(v: Uint8Array | Float32Array | Int32Array, tag: TaTag): TaEnc {
  return { $ta: tag, b64: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
}
function decodeTa(e: TaEnc): Uint8Array | Float32Array | Int32Array {
  const bytes = b64ToBytes(e.b64);
  if (e.$ta === "u8") return bytes;
  const Ctor = TA_CTORS[e.$ta];
  return new Ctor(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
}

// True when every arg is JSON-safe (primitives, plain arrays/objects thereof) or
// one of the supported typed arrays. Class instances, functions, Map/Set, and
// other typed arrays (u16, f64, …) are rejected — such a step stays volatile.
function isSerializableValue(v: unknown, budget: SerializableBudget, depth: number): boolean {
  budget.nodes += 1;
  if (budget.nodes > MAX_ACTION_VALUE_NODES || depth > MAX_ACTION_VALUE_DEPTH) return false;
  if (v === null) return true;
  if (v === undefined) return false;
  const t = typeof v;
  if (t === "string") {
    budget.stringChars += (v as string).length;
    return budget.stringChars <= MAX_ACTION_STRING_CHARS;
  }
  if (t === "number") return Number.isFinite(v);
  if (t === "boolean") return true;
  const tag = taTag(v);
  if (tag !== null) {
    budget.typedArrayBytes += (v as Uint8Array | Float32Array | Int32Array).byteLength;
    return budget.typedArrayBytes <= MAX_ACTION_TYPED_ARRAY_BYTES;
  }
  if (Array.isArray(v)) {
    return v.length <= MAX_ACTION_CONTAINER_ITEMS
      && v.every((item) => isSerializableValue(item, budget, depth + 1));
  }
  if (isPlainObject(v)) {
    if ("$ta" in v || "b64" in v) {
      if (!isTaEnc(v)) return false;
      const byteLength = encodedByteLength(v);
      if (byteLength === null) return false;
      budget.typedArrayBytes += byteLength;
      return budget.typedArrayBytes <= MAX_ACTION_TYPED_ARRAY_BYTES;
    }
    const values = Object.values(v);
    return values.length <= MAX_ACTION_CONTAINER_ITEMS
      && values.every((item) => isSerializableValue(item, budget, depth + 1));
  }
  return false;
}
export function isSerializableArgs(args: unknown[]): boolean {
  if (!Array.isArray(args) || args.length > MAX_ACTION_CONTAINER_ITEMS) return false;
  const budget: SerializableBudget = { nodes: 0, stringChars: 0, typedArrayBytes: 0 };
  return args.every((item) => isSerializableValue(item, budget, 0));
}

/** One object, one reference: live-drag collapse compares leading args with ===. */
export const ACTIVE_LAYER_ARG: { readonly $active: 1 } = { $active: 1 };

/** Commands whose first argument is a layer id. A width that happens to equal
 *  the active id (newDocument) is not in this set, so it is recorded verbatim. */
const LAYER_ID_OPS = new Set([
  "store.deleteLayer", "store.duplicateLayer", "store.selectLayer",
  "store.setLayerOpacity", "store.setLayerBlend", "store.setLayerLocked", "store.setLayerVisible",
  "store.setFillOpacity", "store.renameLayer", "store.mergeDown",
  "store.addLayerMask", "store.addLayerMaskHidden", "store.addLayerMaskRevealSelection", "store.addLayerMaskHideSelection",
  "store.applyLayerMask", "store.deleteLayerMask", "store.maskFromTransparency", "store.setLayerMaskEnabled",
  "store.setEffect", "store.clearEffect", "store.clearAllEffects", "store.setEffectAt", "store.removeEffectAt",
  "store.setBlendIf", "store.setLayerMaskDensity", "store.setLayerMaskFeather",
]);

export function isActiveLayerArg(value: unknown): boolean {
  return isPlainObject(value) && value.$active === 1 && Object.keys(value).length === 1;
}

/** Record a layer-id step against the layer that will be active at play time.
 *  selectLayer stores a name (or a relative offset). Other ops store a sentinel
 *  only when the recorded id is the then-active layer, so a saved literal id
 *  keeps meaning that id. */
export function retargetRecordedLayerArg(
  path: string,
  args: unknown[],
  activeLayerId: number,
  layers: readonly { id: number; name: string }[],
): unknown[] {
  if (!LAYER_ID_OPS.has(path) || args.length === 0) return args;
  const id = args[0];
  if (typeof id !== "number") return args;
  if (path === "store.selectLayer") {
    const layer = layers.find((l) => l.id === id);
    return layer ? [{ name: layer.name }] : args;
  }
  if (id === activeLayerId) return [ACTIVE_LAYER_ARG, ...args.slice(1)];
  return args;
}

/** Resolve a recorded layer reference against the document that is playing.
 *  A missing id, the active-layer sentinel, an unknown name, or a relative
 *  offset that falls off the stack all land on the layer that is active now. */
export function resolvePlaybackLayerArg(
  path: string,
  args: unknown[],
  activeLayerId: number,
  layers: readonly { id: number; name: string }[],
): unknown[] {
  if (!LAYER_ID_OPS.has(path)) return args;
  if (args.length === 0 || args[0] == null) return [activeLayerId];
  const first = args[0];
  if (isActiveLayerArg(first)) return [activeLayerId, ...args.slice(1)];
  if (path === "store.selectLayer" && isPlainObject(first)) {
    if (typeof first.name === "string") {
      const found = layers.find((l) => l.name === first.name);
      return [found ? found.id : activeLayerId];
    }
    if (typeof first.offset === "number" && Number.isFinite(first.offset)) {
      const index = layers.findIndex((l) => l.id === activeLayerId);
      const next = index >= 0 ? layers[index + first.offset] : undefined;
      return [next ? next.id : activeLayerId];
    }
  }
  return args;
}

/** Insert Menu Item offers only commands that play with no arguments. A
 *  parameterized command (brightness, a layer id, a radius) is recorded by
 *  using it, not by inserting a step that would replay with the id missing. */
export const ZERO_ARG_MENU_PATHS: readonly string[] = [
  "addLayer", "selectAll", "deselect", "commit", "log", "contentAwareFill",
  "store.addLayer", "store.layerViaCopy", "store.layerViaCut", "store.createGroup",
  "store.mergeDown", "store.mergeVisible", "store.flatten",
  "store.selectAll", "store.deselect", "store.invertSelection", "store.reselect",
  "store.copy", "store.copyMerged", "store.cut", "store.paste", "store.pasteInPlace",
  "store.convertGrayscale",
  "xform.revealAll", "xform.flipH", "xform.flipV", "xform.rotate180",
  "adj.invert", "adj.desaturate", "adj.autoTone", "adj.autoContrast", "adj.equalize",
  "fil.despeckle", "fil.sharpenEdges",
];

function encodeValue(v: unknown): unknown {
  const tag = taTag(v);
  if (tag) return encodeTa(v as Uint8Array, tag);
  if (Array.isArray(v)) return v.map(encodeValue);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = encodeValue(val);
    return out;
  }
  return v;
}
function decodeValue(v: unknown): unknown {
  if (isTaEnc(v)) return decodeTa(v);
  if (Array.isArray(v)) return v.map(decodeValue);
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = decodeValue(val);
    return out;
  }
  return v;
}

/** Encode call args to a JSON-safe form (typed arrays → {$ta,b64}). Throws if any
 *  arg isn't serializable — callers gate on isSerializableArgs first. Idempotent:
 *  re-encoding an already-encoded arg leaves it unchanged. */
export function encodeOpArgs(args: unknown[]): unknown[] {
  if (!isSerializableArgs(args)) throw new Error("non-serializable action argument");
  return args.map(encodeValue);
}
/** Decode JSON args back to runtime values (typed arrays reconstituted). */
export function decodeOpArgs(args: unknown[]): unknown[] {
  return args.map(decodeValue);
}

export function serializeActionsFile(actions: PortableAction[], app = "monet-vision", now = Date.now()): string {
  const file: ActionsFile = {
    format: "mvactions", version: 1, app, exportedAt: now,
    actions: actions.map((a) => ({
      name: a.name, favorite: a.favorite, createdAt: a.createdAt,
      set: a.set?.trim() || DEFAULT_ACTION_SET,
      steps: a.steps.map(([path, args]) => [path, encodeOpArgs(args)] as ActionOp),
      ...(a.disabled?.length ? { disabled: a.disabled } : {}),
      ...(a.dialogs?.length ? { dialogs: a.dialogs } : {}),
    })),
  };
  return JSON.stringify(file);
}

/** Parse an .mvactions payload, validating every op path against `allowedOps`
 *  (the visionOps allowlist). Rejection is WHOLE-ACTION: any unknown op or
 *  non-serializable arg drops the entire action (its siblings still import),
 *  because a macro is an ordered sequence with data dependencies. A wrong
 *  `format`, `version !== 1`, or malformed JSON rejects the whole file. Args are
 *  returned still-encoded — decode at play time via decodeOpArgs. */
export function parseActionsFile(
  json: string | null | undefined,
  allowedOps: ReadonlySet<string>,
): { actions: PortableAction[]; rejected: { name: string; reason: string }[] } {
  if (!json) return { actions: [], rejected: [] };
  if (json.length > MAX_ACTIONS_IMPORT_BYTES) {
    return { actions: [], rejected: [{ name: "(file)", reason: "file exceeds the actions import limit" }] };
  }
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { actions: [], rejected: [{ name: "(file)", reason: "malformed JSON" }] }; }
  if (!isPlainObject(data)) return { actions: [], rejected: [{ name: "(file)", reason: "not an mvactions file" }] };
  if (data.format !== "mvactions") return { actions: [], rejected: [{ name: "(file)", reason: `unknown format "${String(data.format)}"` }] };
  if (data.version !== 1) return { actions: [], rejected: [{ name: "(file)", reason: `unsupported version ${String(data.version)}` }] };
  const rawActions = Array.isArray(data.actions) ? data.actions : [];
  if (rawActions.length > MAX_IMPORTED_ACTIONS) {
    return { actions: [], rejected: [{ name: "(file)", reason: "too many actions" }] };
  }
  const actions: PortableAction[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let totalSteps = 0;
  for (const raw of rawActions) {
    if (!isPlainObject(raw)) { rejected.push({ name: "(unnamed)", reason: "malformed action" }); continue; }
    if (typeof raw.name === "string" && raw.name.length > MAX_ACTION_NAME_CHARS) {
      rejected.push({ name: "(unnamed)", reason: "action name is too long" });
      continue;
    }
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "(unnamed)";
    const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
    if (rawSteps.length > MAX_ACTION_STEPS) {
      rejected.push({ name, reason: "too many action steps" });
      continue;
    }
    totalSteps += rawSteps.length;
    if (totalSteps > MAX_ACTION_TOTAL_STEPS) {
      return { actions: [], rejected: [{ name: "(file)", reason: "too many total action steps" }] };
    }
    let reason: string | null = null;
    const steps: ActionOp[] = [];
    for (const step of rawSteps) {
      if (!Array.isArray(step) || typeof step[0] !== "string" || !Array.isArray(step[1])) { reason = "malformed step"; break; }
      const [path, args] = step as ActionOp;
      if (path !== STOP_OP && path !== IF_OP && !allowedOps.has(path)) { reason = `unknown op: ${path}`; break; }
      if (!isSerializableArgs(args)) { reason = `non-serializable args for ${path}`; break; }
      steps.push([path, args]);
    }
    if (reason) { rejected.push({ name, reason }); continue; }
    // Organizational fields are lenient: a malformed set/disabled never rejects
    // the action — worst case it lands in the default set with all steps on.
    const set = typeof raw.set === "string" && raw.set.trim() && raw.set.length <= MAX_ACTION_NAME_CHARS
      ? raw.set.trim() : DEFAULT_ACTION_SET;
    const stepIndices = (v: unknown): number[] => Array.isArray(v)
      ? [...new Set(v.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < steps.length))]
      : [];
    actions.push({ name, favorite: raw.favorite === true, createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(), steps, set, disabled: stepIndices(raw.disabled), dialogs: stepIndices(raw.dialogs) });
  }
  return { actions, rejected };
}

// ── Adobe .atn import (Photoshop's Load Actions…) ────────────────────────────
// An action pack is a set header, then actions, then per-step Photoshop action
// DESCRIPTORS — the same Adobe OSType tree .asl stores. We rebuild the whole
// panel tree (set name, action names, per-step enabled/modal flags) and map the
// steps whose Photoshop event has a visionOps equivalent; every other step
// imports as an Insert Stop naming the command, so the sequence stays intact and
// playback halts where the pack expected work instead of silently skipping it.
//
// ponytail: the descriptor reader is a lean second copy of the .asl one in
// stylePresets.ts (which doesn't export it) — fold both into one shared Adobe
// descriptor module when a third binary format needs it. ATN_EVENTS covers the
// events whose parameters map unambiguously; widen it as more of Photoshop's
// descriptor vocabulary gets modelled (VIS-ACT-02 is the real replay ceiling).

export const MAX_ATN_IMPORT_BYTES = 8 * 1024 * 1024;
const MAX_ATN_ITEMS = 4096; // descriptor entries, list lengths, key lengths
const MAX_ATN_DEPTH = 24;

type AtnDesc = Record<string, unknown>;

/** Big-endian cursor over the .atn bytes; every read is bounds-checked so a
 *  truncated or hostile pack throws instead of reading past the buffer. */
class AtnReader {
  p = 0;
  private view: DataView;
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  private need(n: number) {
    if (n < 0 || this.p + n > this.buf.length) throw new Error("actions file is truncated");
  }
  u8() { this.need(1); return this.buf[this.p++]; }
  u16() { this.need(2); const v = this.view.getUint16(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.view.getUint32(this.p); this.p += 4; return v; }
  i32() { this.need(4); const v = this.view.getInt32(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.view.getFloat64(this.p); this.p += 8; return v; }
  skip(n: number) { this.need(n); this.p += n; }
  ascii(n: number) {
    this.need(n);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.buf[this.p + i]);
    this.p += n;
    return s;
  }
  /** Adobe key: u32 length, where 0 means the classic 4-character key. */
  key() {
    const n = this.u32();
    if (n > MAX_ATN_ITEMS) throw new Error("actions key is too long");
    return this.ascii(n === 0 ? 4 : n);
  }
  /** Adobe Unicode string: u32 UTF-16 code-unit count then UTF-16BE (NUL-terminated). */
  ustr() {
    const n = this.u32();
    this.need(n * 2);
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u16());
    return s.replace(/\0+$/, "");
  }
}

/** One item of an `obj ` object reference. Consumed for its length only — a
 *  step's target (which layer/channel) is never what we map an op from. */
function readAtnRef(r: AtnReader) {
  const form = r.ascii(4);
  switch (form) {
    case "prop": r.ustr(); r.key(); r.key(); break;
    case "Clss": r.ustr(); r.key(); break;
    case "Enmr": r.ustr(); r.key(); r.key(); r.key(); break;
    case "rele": r.ustr(); r.key(); r.i32(); break;
    case "Idnt": case "indx": r.ustr(); r.key(); r.u32(); break;
    case "name": r.ustr(); r.key(); r.ustr(); break;
    default: throw new Error(`unsupported action reference (${form})`);
  }
}

/** Decode one descriptor value. Numbers/units collapse to plain numbers and
 *  text/enums to strings — enough for argument mapping; structural-only types
 *  decode to null but are still fully consumed so the cursor stays in sync. */
function readAtnVal(r: AtnReader, depth: number): unknown {
  if (depth > MAX_ATN_DEPTH) throw new Error("actions descriptor nests too deeply");
  const os = r.ascii(4);
  switch (os) {
    case "Objc": case "GlbO": return readAtnDesc(r, depth + 1);
    case "VlLs": {
      const n = r.u32();
      if (n > MAX_ATN_ITEMS) throw new Error("actions list is too long");
      const v: unknown[] = [];
      for (let i = 0; i < n; i++) v.push(readAtnVal(r, depth + 1));
      return v;
    }
    case "doub": return r.f64();
    case "UntF": { r.ascii(4); return r.f64(); }
    case "long": return r.i32();
    case "bool": return r.u8() !== 0;
    case "TEXT": return r.ustr();
    case "enum": { r.key(); return r.key(); }
    case "obj ": {
      const n = r.u32();
      if (n > MAX_ATN_ITEMS) throw new Error("actions reference is too long");
      for (let i = 0; i < n; i++) readAtnRef(r);
      return null;
    }
    case "comp": r.skip(8); return null;
    case "tdta": case "alis": r.skip(r.u32()); return null;
    case "type": case "GlbC": r.ustr(); r.key(); return null;
    case "UnFl": {
      r.ascii(4);
      const n = r.u32();
      if (n > MAX_ATN_ITEMS) throw new Error("actions float list is too long");
      r.skip(n * 8);
      return null;
    }
    default: throw new Error(`unsupported action data (${os})`);
  }
}

function readAtnDesc(r: AtnReader, depth: number): AtnDesc {
  r.ustr(); // class display name (Photoshop writes it empty)
  r.key();  // classID
  const n = r.u32();
  if (n > MAX_ATN_ITEMS) throw new Error("actions descriptor is too large");
  const out: AtnDesc = {};
  for (let i = 0; i < n; i++) out[r.key()] = readAtnVal(r, depth + 1);
  return out;
}

/** A step descriptor carries a leading u32 descriptor version (16) in some
 *  Photoshop builds and not in others. A descriptor otherwise opens with its
 *  class DISPLAY name, which Photoshop always writes empty (u32 0), so a
 *  leading 16 is unambiguously the version word.
 *  ponytail: a pack with a 16-character class display name would fool this —
 *  the parse then aborts cleanly; drop the sniff if a real file ever needs it. */
function readAtnStepDesc(r: AtnReader): AtnDesc {
  const save = r.p;
  if (r.u32() !== 16) r.p = save;
  return readAtnDesc(r, 0);
}

function atnNum(d: AtnDesc, k: string): number | null {
  const v = d[k];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
/** A descriptor number as the 0..1 fraction the visionOp wants — `full` is the
 *  Photoshop range's top (100 for a percentage, 255 for a level). */
function atnFrac(d: AtnDesc, k: string, full: number): number | null {
  const v = atnNum(d, k);
  return v === null ? null : v / full;
}
/** null if any parameter is missing — the step then imports as a Stop rather
 *  than replaying with invented arguments. */
function atnArgs(...vals: (number | null)[]): number[] | null {
  return vals.every((v) => v !== null) ? (vals as number[]) : null;
}

/** How one visionOp argument is written back into a Photoshop descriptor:
 *  `unit` makes it a UntF double (else a long), `scale` un-normalises the
 *  0..1 fraction the visionOp uses into Photoshop's range. */
interface AtnParam { key: string; unit?: string; scale?: number }
interface AtnEvent {
  op: string;
  args?: (d: AtnDesc) => unknown[] | null;
  /** Present = this event can be written back out; absent on a parameterised
   *  event means "import only", and such a step exports as a Stop. */
  write?: AtnParam[];
}

/** Photoshop event ID → visionOps path. Only counts pass through as-is
 *  (Posterize's Lvls is a 2..255 level count in both); every other Photoshop
 *  range is normalised to the fraction the visionOp wants — percentages
 *  (Brightness/Contrast #139, Unsharp Mask's Amount #140) by /100 and 0..255
 *  levels (Threshold #138, Unsharp Mask's Threshold #140) by /255. */
const ATN_EVENTS: Record<string, AtnEvent> = {
  // Photoshop's Insert Stop. Vision has the same pseudo-op, so it maps directly
  // rather than becoming an "unsupported step" stop about a stop.
  "Stop": { op: STOP_OP, args: (d) => [typeof d["Msge"] === "string" ? d["Msge"] : "Stop", d["Cntn"] === true] },
  // no-argument commands
  "Dslc": { op: "store.deselect" },
  "Invs": { op: "store.invertSelection" },
  "Rslc": { op: "store.reselect" },
  "Invr": { op: "adj.invert" },
  "Dsat": { op: "adj.desaturate" },
  "AutL": { op: "adj.autoTone" },
  "AutC": { op: "adj.autoContrast" },
  "Eqlz": { op: "adj.equalize" },
  "FltI": { op: "store.flatten" },
  "MrgV": { op: "store.mergeVisible" },
  "Mrg2": { op: "store.mergeDown" },
  "Dspc": { op: "fil.despeckle" },
  "ShrE": { op: "fil.sharpenEdges" },
  "RvlA": { op: "xform.revealAll" },
  // parameterised commands
  "GsnB": { op: "fil.gaussian", args: (d) => atnArgs(atnNum(d, "Rds ")), write: [{ key: "Rds ", unit: "#Pxl" }] },
  "Mdn ": { op: "fil.median", args: (d) => atnArgs(atnNum(d, "Rds ")), write: [{ key: "Rds ", unit: "#Pxl" }] },
  // Photoshop's Level is a 0..255 luminance; adj.threshold wants the 0..1
  // fraction the dialog passes, so a raw 128 would blacken every pixel (#138).
  "Thrs": { op: "adj.threshold", args: (d) => atnArgs(atnFrac(d, "Lvl ", 255)), write: [{ key: "Lvl ", scale: 255 }] },
  "Pstr": { op: "adj.posterize", args: (d) => atnArgs(atnNum(d, "Lvls")), write: [{ key: "Lvls" }] },
  // Photoshop writes both as ±100 percentages; adj.brightnessContrast wants
  // −1..1, and a raw −5 contrast inverts the layer about mid-grey (#139).
  "BrgC": { op: "adj.brightnessContrast", args: (d) => atnArgs(atnFrac(d, "Brgh", 100), atnFrac(d, "Cntr", 100)),
    write: [{ key: "Brgh", scale: 100 }, { key: "Cntr", scale: 100 }] },
  // Amount is a percent, Threshold a 0..255 level; fil.unsharp takes both as
  // 0..1 fractions (#140).
  "UnsM": { op: "fil.unsharp", args: (d) => atnArgs(atnNum(d, "Rds "), atnFrac(d, "Amnt", 100), atnFrac(d, "Thsh", 255)),
    write: [{ key: "Rds ", unit: "#Pxl" }, { key: "Amnt", unit: "#Prc", scale: 100 }, { key: "Thsh", scale: 255 }] },
};

function atnStep(event: string, label: string, desc: AtnDesc): ActionOp {
  const mapped = ATN_EVENTS[event];
  const args = mapped ? (mapped.args ? mapped.args(desc) : []) : null;
  if (mapped && args) return [mapped.op, args];
  return [STOP_OP, [`Unsupported Photoshop step: ${label}`.slice(0, MAX_ACTION_NAME_CHARS), true]];
}

function readAtnAction(r: AtnReader, set: string, now: number): PortableAction {
  r.u32(); // function-key index
  r.u8();  // shift key
  r.u8();  // command key
  r.u16(); // colour index
  const name = r.ustr().trim().slice(0, MAX_ACTION_NAME_CHARS) || "(unnamed)";
  r.u8();  // expanded
  const count = r.u32();
  if (count > MAX_ACTION_STEPS) throw new Error(`"${name}" has too many steps`);
  const steps: ActionOp[] = [];
  const disabled: number[] = [];
  const dialogs: number[] = [];
  for (let i = 0; i < count; i++) {
    r.u8(); // expanded
    const enabled = r.u8() !== 0;
    const withDialog = r.u8() !== 0;
    r.u8(); // dialog options
    const event = r.key();
    const label = r.ustr().trim() || event.trim() || "step";
    steps.push(atnStep(event, label, r.u32() !== 0 ? readAtnStepDesc(r) : {}));
    if (!enabled) disabled.push(i);
    if (withDialog) dialogs.push(i);
  }
  return { name, favorite: false, createdAt: now, steps, set, disabled, dialogs };
}

export interface AtnImport {
  setName: string;
  actions: PortableAction[];
  /** Non-null when parsing stopped early; `actions` still holds what was read
   *  before the unreadable byte, which is what Photoshop packs mostly need —
   *  one exotic descriptor shouldn't cost the whole pack. */
  error: string | null;
}

/** Parse an Adobe .atn action pack. Never throws: a malformed or unsupported
 *  region ends the parse and is reported through `error`. */
export function parseAtn(bytes: Uint8Array, now = Date.now()): AtnImport {
  const r = new AtnReader(bytes);
  const actions: PortableAction[] = [];
  let setName = DEFAULT_ACTION_SET;
  try {
    const version = r.u32();
    if (version !== 16) throw new Error(`not an Adobe .atn file (version ${version})`);
    setName = r.ustr().trim().slice(0, MAX_ACTION_NAME_CHARS) || DEFAULT_ACTION_SET;
    r.u8(); // set expanded
    const count = r.u32();
    if (count > MAX_IMPORTED_ACTIONS) throw new Error("too many actions");
    for (let i = 0; i < count; i++) actions.push(readAtnAction(r, setName, now));
  } catch (e) {
    return { setName, actions, error: e instanceof Error ? e.message : String(e) };
  }
  return { setName, actions, error: null };
}

// ── Adobe .atn writing (Photoshop's Save Actions) ────────────────────────────
// The inverse of the reader above: a version-16 pack holding ONE action set.
// A step whose op has an ATN_EVENTS entry with a `write` spec goes out as that
// Photoshop event (arguments un-normalised back into Photoshop's ranges);
// everything else — Vision-only commands, conditionals, recorded tool gestures —
// goes out as a Photoshop Stop naming the command, so the set still loads and
// replays in order with the gap visible instead of silently missing.

/** visionOps path → the Photoshop event that writes it. */
const ATN_WRITERS: Record<string, { event: string; params: AtnParam[] }> = (() => {
  const out: Record<string, { event: string; params: AtnParam[] }> = {};
  for (const [event, ev] of Object.entries(ATN_EVENTS)) {
    if (ev.args && !ev.write) continue; // parameterised but unwritable: import only
    if (ev.op === STOP_OP) continue;    // stops have their own writer below
    out[ev.op] = { event, params: ev.write ?? [] };
  }
  return out;
})();

class AtnWriter {
  private bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.u8(v >> 8); this.u8(v); }
  u32(v: number) { this.u8(v >> 24); this.u8(v >> 16); this.u8(v >> 8); this.u8(v); }
  i32(v: number) { this.u32(v | 0); }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    for (const x of b) this.u8(x);
  }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i)); }
  /** Adobe key: 0 length means the classic 4-character key follows. */
  key(k: string) {
    if (k.length === 4) { this.u32(0); this.ascii(k); } else { this.u32(k.length); this.ascii(k); }
  }
  /** Adobe Unicode string: UTF-16BE, NUL-terminated, the count including it. */
  ustr(s: string) {
    this.u32(s.length + 1);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    this.u16(0);
  }
  done(): Uint8Array { return Uint8Array.from(this.bytes); }
}

/** One descriptor: the version word Photoshop writes, the (empty) class display
 *  name, the class id, then the items. */
function writeAtnDesc(w: AtnWriter, classId: string, items: { key: string; write: (w: AtnWriter) => void }[]) {
  w.u32(16);
  w.ustr("");
  w.key(classId);
  w.u32(items.length);
  for (const item of items) { w.key(item.key); item.write(w); }
}

function writeAtnStop(w: AtnWriter, message: string, allowContinue: boolean) {
  w.key("Stop");
  w.ustr("Stop");
  w.u32(1);
  writeAtnDesc(w, "Stop", [
    { key: "Msge", write: (d) => { d.ascii("TEXT"); d.ustr(message.slice(0, MAX_ACTION_NAME_CHARS)); } },
    { key: "Cntn", write: (d) => { d.ascii("bool"); d.u8(allowContinue ? 1 : 0); } },
  ]);
}

/** ponytail: a long-typed parameter (Threshold's level, Brightness/Contrast)
 *  quantises to Photoshop's own integer range on the way out — the same value
 *  its dialog would have produced. Fractions between two levels do not survive
 *  a round trip; nothing but a format change can keep them. */
function writeAtnStep(w: AtnWriter, op: ActionOp) {
  const [path, args] = op;
  if (path === STOP_OP) {
    const { message, allowContinue } = parseStopArgs(args);
    writeAtnStop(w, message, allowContinue);
    return;
  }
  const mapped = ATN_WRITERS[path];
  const nums = args.filter((a): a is number => typeof a === "number" && Number.isFinite(a));
  if (!mapped || nums.length < mapped.params.length) {
    writeAtnStop(w, `Vision step Photoshop cannot replay: ${stepLabel(path)}`, true);
    return;
  }
  w.key(mapped.event);
  w.ustr(stepLabel(path)); // the display name Photoshop shows in its step list
  if (mapped.params.length === 0) { w.u32(0); return; }
  w.u32(1);
  writeAtnDesc(w, mapped.event, mapped.params.map((param, i) => ({
    key: param.key,
    write: (d: AtnWriter) => {
      const value = nums[i] * (param.scale ?? 1);
      // Photoshop's own dialogs carry at most a few decimals, and un-normalising
      // a fraction leaves float dust (0.8 × 100 = 80.000000000000014) that would
      // come back as a different number.
      if (param.unit) { d.ascii("UntF"); d.ascii(param.unit); d.f64(Math.round(value * 1e4) / 1e4); }
      else { d.ascii("long"); d.i32(Math.round(value)); }
    },
  })));
}

/** Write an Adobe .atn action set Photoshop can load. */
export function serializeAtn(actions: readonly PortableAction[], setName?: string): Uint8Array {
  const w = new AtnWriter();
  const name = (setName ?? actions[0]?.set ?? "").trim().slice(0, MAX_ACTION_NAME_CHARS);
  w.u32(16); // pack version
  w.ustr(name || DEFAULT_ACTION_SET);
  w.u8(1);   // set expanded
  w.u32(actions.length);
  for (const a of actions) {
    w.u32(0); // no function key
    w.u8(0);  // …so no shift
    w.u8(0);  // …and no command
    w.u16(0); // colour: none
    w.ustr(a.name.slice(0, MAX_ACTION_NAME_CHARS));
    w.u8(1);  // expanded
    const steps = a.steps.slice(0, MAX_ACTION_STEPS);
    const disabled = new Set(a.disabled ?? []);
    const dialogs = new Set(a.dialogs ?? []);
    w.u32(steps.length);
    steps.forEach((op, i) => {
      w.u8(1);                          // expanded
      w.u8(disabled.has(i) ? 0 : 1);    // enabled
      w.u8(dialogs.has(i) ? 1 : 0);     // pauses for its dialog
      w.u8(0);                          // dialog options
      writeAtnStep(w, op);
    });
  }
  return w.done();
}

/** Adobe .atn → an .mvactions payload, so the ordinary import path (visionOps
 *  allowlist validation, duplicate renaming, persistence) handles it unchanged. */
export function atnToActionsFile(bytes: Uint8Array, now = Date.now()): { json: string; setName: string; error: string | null } {
  const { setName, actions, error } = parseAtn(bytes, now);
  return { json: serializeActionsFile(actions, "adobe-atn", now), setName, error };
}
