// factory — constructors with sensible After-Effects-like defaults.

import { newId, resetIds } from "./ids";
import type { AnimeProject, BlendMode, Composition, Layer, LayerKind, Transform } from "./types";

const PALETTE = ["#e64980", "#4dabf7", "#69db7c", "#ffd43b", "#da77f2", "#ff922b", "#22b8cf"];
let colorTick = 0;
const nextColor = () => PALETTE[colorTick++ % PALETTE.length];

export function makeTransform(x: number, y: number, anchorX: number, anchorY: number): Transform {
  return { x, y, anchorX, anchorY, scaleX: 100, scaleY: 100, rotation: 0, opacity: 100 };
}

export interface NewLayerOptions {
  name?: string;
  color?: string;
  width?: number;
  height?: number;
  /** Image data URL (kind `"image"`). Self-contained so it survives save/load. */
  src?: string;
}

export function createLayer(kind: LayerKind, comp: Composition, opts: NewLayerOptions = {}): Layer {
  const isText = kind === "text";
  const width = opts.width ?? (kind === "solid" ? comp.width : isText ? 600 : 300);
  const height = opts.height ?? (kind === "solid" ? comp.height : isText ? 160 : 300);
  const color = opts.color ?? (kind === "solid" ? "#3b3b46" : nextColor());
  const defaultName =
    opts.name ??
    { solid: "Solid", shape: "Shape", text: "Text", image: "Image", null: "Null" }[kind];
  const layer: Layer = {
    id: newId("layer"),
    name: defaultName,
    kind,
    visible: true,
    locked: false,
    solo: false,
    inPoint: 0,
    outPoint: comp.duration,
    blendMode: "normal" as BlendMode,
    transform: makeTransform(comp.width / 2, comp.height / 2, width / 2, height / 2),
    tracks: [],
    effects: [],
    color,
    width,
    height,
  };
  if (kind === "shape") layer.shape = "rect";
  if (kind === "image" && opts.src) layer.src = opts.src;
  if (kind === "text") {
    layer.text = "Text";
    layer.fontSize = 96;
    layer.fontFamily = "Inter, system-ui, sans-serif";
    layer.align = "center";
    layer.color = "#ffffff";
  }
  return layer;
}

export function createComposition(name = "Comp 1", over: Partial<Composition> = {}): Composition {
  return {
    id: newId("comp"),
    name,
    width: over.width ?? 1920,
    height: over.height ?? 1080,
    fps: over.fps ?? 30,
    duration: over.duration ?? 6,
    background: over.background ?? "#0b0b10",
    layers: over.layers ?? [],
  };
}

/** A fresh project with one composition + a couple of starter layers, so the
 *  app opens to something visible rather than an empty stage. */
export function createProject(name = "Untitled"): AnimeProject {
  resetIds();
  colorTick = 0;
  const comp = createComposition("Comp 1");
  const title = createLayer("text", comp, { name: "Title" });
  title.text = "MONET ANIME";
  title.fontSize = 140;
  const badge = createLayer("shape", comp, { name: "Badge", width: 360, height: 360, color: "#e64980" });
  badge.shape = "ellipse";
  badge.transform.y = comp.height / 2 + 220;
  comp.layers = [title, badge]; // title on top
  return { name, compositions: [comp], activeCompId: comp.id };
}
