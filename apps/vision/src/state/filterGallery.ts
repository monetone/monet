// ─────────────────────────────────────────────────────────────
// Filter Gallery — the pure-TS model behind the Photoshop-style
// Filter Gallery dialog. It owns the filter catalog (grouped by
// category, with each filter's slider ranges + UI→engine arg
// conversion) and the stacked, reorderable "effect layer" list
// operations. Everything here is engine-free so it is node-testable
// (mirrors the other src/state pure leaves); the dialog and the
// app.ts action layer dispatch the converted args to the real
// `fil`/`distort` engine filters.
// ─────────────────────────────────────────────────────────────

export type GalleryCategory =
  | "Artistic" | "Brush Strokes" | "Distort" | "Sketch" | "Stylize" | "Texture" | "Pixelate";

// Display order of the category groups in the thumbnail picker.
export const GALLERY_CATEGORIES: GalleryCategory[] = [
  "Artistic", "Brush Strokes", "Distort", "Sketch", "Stylize", "Texture", "Pixelate",
];

// One slider in a filter's parameter panel. `min`/`max` are the UI range
// (what the user sees, matching the standalone filter dialogs); `def` is the
// seeded value when the effect is added.
export interface GalleryParam {
  key: string;
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number; // slider/readout step; default 1
  suffix?: string;
  options?: string[]; // discrete choices; value is min + option index
}

export interface GalleryFilterDef {
  id: string;
  name: string;
  category: GalleryCategory;
  /** `distort.*` action instead of `fil.*` (Ocean Ripple / Glass). */
  lib?: "fil" | "distort";
  params: GalleryParam[];
  /** Pure UI-values → engine-action-arguments conversion (matches each
   *  standalone filter dialog's OK handler). */
  args: (v: number[]) => number[];
}

// A stacked effect "layer": which filter, its current UI values, and whether
// it contributes to the composed result (the eye toggle).
export interface GalleryEffect {
  id: string;
  values: number[];
  visible: boolean;
}

const r = Math.round;

// ── Catalog ────────────────────────────────────────────────────
// Ranges/defaults/conversions are transcribed from the standalone filter
// dialogs in ui/Dialogs.tsx so the gallery produces identical results.
export const GALLERY_FILTERS: GalleryFilterDef[] = [
  // ── Artistic ──
  {
    id: "posterEdges", name: "Poster Edges", category: "Artistic",
    params: [
      { key: "levels", label: "Posterization", min: 2, max: 8, def: 4 },
      { key: "thickness", label: "Edge Thickness", min: 1, max: 10, def: 1, suffix: "px" },
      { key: "intensity", label: "Edge Intensity", min: 0, max: 10, def: 4 },
    ],
    args: (v) => [r(v[0]), r(v[1]), v[2]],
  },
  {
    id: "cutout", name: "Cutout", category: "Artistic",
    params: [
      { key: "levels", label: "No. of Levels", min: 2, max: 8, def: 4 },
      { key: "simplicity", label: "Edge Simplicity", min: 0, max: 10, def: 4 },
      { key: "fidelity", label: "Edge Fidelity", min: 1, max: 3, def: 2 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "filmGrain", name: "Film Grain", category: "Artistic",
    params: [
      { key: "grain", label: "Grain", min: 0, max: 20, def: 4 },
      { key: "highlight", label: "Highlight Area", min: 0, max: 20, def: 0 },
      { key: "intensity", label: "Intensity", min: 0, max: 10, def: 5 },
    ],
    args: (v) => [v[0] / 20, v[1] / 20, v[2] / 10],
  },
  {
    id: "dryBrush", name: "Dry Brush", category: "Artistic",
    params: [
      { key: "size", label: "Brush Size", min: 0, max: 10, def: 6 },
      { key: "detail", label: "Brush Detail", min: 0, max: 10, def: 5 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 1 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "coloredPencil", name: "Colored Pencil", category: "Artistic",
    params: [
      { key: "width", label: "Pencil Width", min: 1, max: 24, def: 4 },
      { key: "pressure", label: "Stroke Pressure", min: 0, max: 15, def: 8 },
      { key: "brightness", label: "Paper Brightness", min: 0, max: 50, def: 25 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "fresco", name: "Fresco", category: "Artistic",
    params: [
      { key: "size", label: "Brush Size", min: 0, max: 10, def: 2 },
      { key: "detail", label: "Brush Detail", min: 0, max: 10, def: 8 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 1 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "paletteKnife", name: "Palette Knife", category: "Artistic",
    params: [
      { key: "size", label: "Stroke Size", min: 1, max: 50, def: 25 },
      { key: "detail", label: "Stroke Detail", min: 1, max: 3, def: 3 },
      { key: "softness", label: "Softness", min: 0, max: 10, def: 0 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "paintDaubs", name: "Paint Daubs", category: "Artistic",
    params: [
      { key: "size", label: "Brush Size", min: 1, max: 50, def: 8 },
      { key: "sharpness", label: "Sharpness", min: 0, max: 40, def: 7 },
      { key: "type", label: "Brush Type", min: 0, max: 5, def: 0, options: ["Simple", "Light Rough", "Dark Rough", "Wide Sharp", "Wide Blurry", "Sparkle"] },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "roughPastels", name: "Rough Pastels", category: "Artistic",
    params: [
      { key: "length", label: "Stroke Length", min: 0, max: 40, def: 20 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 0, options: ["Canvas", "Sandstone", "Brick", "Burlap"] },
      { key: "scaling", label: "Scaling", min: 50, max: 200, def: 100, suffix: "%" },
      { key: "relief", label: "Relief", min: 0, max: 50, def: 25 },
      { key: "light", label: "Light", min: 0, max: 7, def: 1, options: ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"] },
    ],
    args: (v) => [r(v[0]), r(v[1]), (v[2] - 50) / 150, v[3] / 50, r(v[4])],
  },
  {
    id: "smudgeStick", name: "Smudge Stick", category: "Artistic",
    params: [
      { key: "length", label: "Stroke Length", min: 0, max: 10, def: 2 },
      { key: "highlight", label: "Highlight Area", min: 0, max: 20, def: 10 },
      { key: "intensity", label: "Intensity", min: 0, max: 10, def: 10 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "sponge", name: "Sponge", category: "Artistic",
    params: [
      { key: "size", label: "Brush Size", min: 0, max: 10, def: 2 },
      { key: "definition", label: "Definition", min: 0, max: 25, def: 12 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 5 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "underpainting", name: "Underpainting", category: "Artistic",
    params: [
      { key: "size", label: "Brush Size", min: 0, max: 40, def: 6 },
      { key: "coverage", label: "Texture Coverage", min: 0, max: 40, def: 16 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 0, options: ["Canvas", "Sandstone", "Brick", "Burlap"] },
      { key: "scaling", label: "Scaling", min: 50, max: 200, def: 100, suffix: "%" },
      { key: "relief", label: "Relief", min: 0, max: 50, def: 20 },
      { key: "light", label: "Light", min: 0, max: 7, def: 1, options: ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"] },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2]), (v[3] - 50) / 150, v[4] / 50, r(v[5])],
  },
  {
    id: "watercolor", name: "Watercolor", category: "Artistic",
    params: [
      { key: "detail", label: "Brush Detail", min: 1, max: 14, def: 6 },
      { key: "shadow", label: "Shadow Intensity", min: 0, max: 10, def: 0 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 1 },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "neonGlow", name: "Neon Glow", category: "Artistic",
    params: [
      { key: "size", label: "Glow Size", min: -24, max: 24, def: 0 },
      { key: "brightness", label: "Glow Brightness", min: 0, max: 50, def: 25 },
    ],
    args: (v) => [v[0] / 24, v[1] / 50],
  },
  {
    id: "plasticWrap", name: "Plastic Wrap", category: "Artistic",
    params: [
      { key: "highlight", label: "Highlight Strength", min: 0, max: 20, def: 15 },
      { key: "detail", label: "Detail", min: 1, max: 15, def: 9 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 7 },
    ],
    args: (v) => [v[0] / 20, v[1] / 15, v[2] / 15],
  },

  // ── Brush Strokes ──
  {
    id: "crosshatch", name: "Crosshatch", category: "Brush Strokes",
    params: [
      { key: "length", label: "Stroke Length", min: 1, max: 50, def: 9 },
      { key: "sharpness", label: "Sharpness", min: 0, max: 20, def: 6 },
      { key: "strength", label: "Strength", min: 1, max: 3, def: 1 },
    ],
    args: (v) => [v[0] / 50, v[1] / 20, v[2] / 3],
  },
  {
    id: "spatter", name: "Spatter", category: "Brush Strokes",
    params: [
      { key: "radius", label: "Spray Radius", min: 0, max: 25, def: 10 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 5 },
    ],
    args: (v) => [v[0], v[1]],
  },
  {
    id: "angledStrokes", name: "Angled Strokes", category: "Brush Strokes",
    params: [
      { key: "length", label: "Stroke Length", min: 3, max: 50, def: 15 },
      { key: "balance", label: "Direction Balance", min: 0, max: 100, def: 50 },
      { key: "sharpness", label: "Sharpness", min: 0, max: 10, def: 3 },
    ],
    args: (v) => [v[0], v[1] / 100, v[2] / 10],
  },
  {
    id: "darkStrokes", name: "Dark Strokes", category: "Brush Strokes",
    params: [
      { key: "balance", label: "Balance", min: 0, max: 10, def: 5 },
      { key: "black", label: "Black Intensity", min: 0, max: 10, def: 5 },
      { key: "white", label: "White Intensity", min: 0, max: 10, def: 3 },
    ],
    args: (v) => [v[0] / 10, v[1] / 10, v[2] / 10],
  },
  {
    id: "sprayedStrokes", name: "Sprayed Strokes", category: "Brush Strokes",
    params: [
      { key: "length", label: "Stroke Length", min: 0, max: 20, def: 12 },
      { key: "radius", label: "Spray Radius", min: 0, max: 25, def: 7 },
      { key: "direction", label: "Stroke Direction", min: 0, max: 3, def: 0, options: ["Right Diagonal", "Horizontal", "Left Diagonal", "Vertical"] },
    ],
    args: (v) => [v[0], v[1], r(v[2])],
  },
  {
    id: "sumiE", name: "Sumi-e", category: "Brush Strokes",
    params: [
      { key: "width", label: "Stroke Width", min: 0, max: 15, def: 10 },
      { key: "pressure", label: "Stroke Pressure", min: 0, max: 15, def: 2 },
      { key: "contrast", label: "Contrast", min: 0, max: 40, def: 16 },
    ],
    args: (v) => [v[0] / 15, v[1] / 15, v[2] / 40],
  },
  {
    id: "accentedEdges", name: "Accented Edges", category: "Brush Strokes",
    params: [
      { key: "width", label: "Edge Width", min: 1, max: 14, def: 2 },
      { key: "brightness", label: "Edge Brightness", min: 0, max: 50, def: 38 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 5 },
    ],
    args: (v) => [v[0] / 14, v[1] / 50, v[2] / 15],
  },
  {
    id: "inkOutlines", name: "Ink Outlines", category: "Brush Strokes",
    params: [
      { key: "length", label: "Stroke Length", min: 1, max: 50, def: 4 },
      { key: "dark", label: "Dark Intensity", min: 0, max: 50, def: 20 },
      { key: "light", label: "Light Intensity", min: 0, max: 50, def: 10 },
    ],
    args: (v) => [v[0] / 50, v[1] / 50, v[2] / 50],
  },

  // ── Distort ──
  {
    id: "oceanRipple", name: "Ocean Ripple", category: "Distort", lib: "distort",
    params: [
      { key: "size", label: "Ripple Size", min: 1, max: 15, def: 9 },
      { key: "magnitude", label: "Ripple Magnitude", min: 0, max: 20, def: 10 },
    ],
    args: (v) => [v[0] / 15, v[1] / 20],
  },
  {
    id: "glass", name: "Glass", category: "Distort", lib: "distort",
    params: [
      { key: "texture", label: "Texture", min: 0, max: 2, def: 0, options: ["Frosted", "Blocks", "Canvas"] },
      { key: "distortion", label: "Distortion", min: 0, max: 20, def: 10 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 3 },
      { key: "scaling", label: "Scaling", min: 50, max: 200, def: 100, suffix: "%" },
    ],
    args: (v) => [r(v[0]), v[1] / 20, v[2] / 15, (v[3] - 50) / 150],
  },
  {
    id: "diffuseGlow", name: "Diffuse Glow", category: "Distort", lib: "distort",
    params: [
      { key: "graininess", label: "Graininess", min: 0, max: 10, def: 0 },
      { key: "glow", label: "Glow Amount", min: 0, max: 20, def: 10 },
      { key: "clear", label: "Clear Amount", min: 0, max: 20, def: 5 },
    ],
    args: (v) => [v[0], v[1], v[2]],
  },

  // ── Sketch ──
  {
    id: "photocopy", name: "Photocopy", category: "Sketch",
    params: [
      { key: "detail", label: "Detail", min: 1, max: 24, def: 2 },
      { key: "darkness", label: "Darkness", min: 1, max: 50, def: 8 },
    ],
    args: (v) => [r(v[0]), v[1]],
  },
  {
    id: "graphicPen", name: "Graphic Pen", category: "Sketch",
    params: [
      { key: "length", label: "Stroke Length", min: 1, max: 15, def: 9 },
      { key: "balance", label: "Light/Dark Balance", min: 0, max: 100, def: 50 },
      { key: "direction", label: "Stroke Direction", min: 0, max: 3, def: 0, options: ["Right Diagonal", "Horizontal", "Left Diagonal", "Vertical"] },
    ],
    args: (v) => [v[0] / 15, v[1] / 100, r(v[2])],
  },
  {
    id: "charcoal", name: "Charcoal", category: "Sketch",
    params: [
      { key: "thickness", label: "Charcoal Thickness", min: 1, max: 7, def: 1 },
      { key: "detail", label: "Detail", min: 0, max: 5, def: 5 },
      { key: "balance", label: "Light/Dark Balance", min: 0, max: 100, def: 50 },
    ],
    args: (v) => [r(v[0]), r(v[1]), v[2] / 100],
  },
  {
    id: "halftonePattern", name: "Halftone Pattern", category: "Sketch",
    params: [
      { key: "size", label: "Size", min: 1, max: 12, def: 4 },
      { key: "contrast", label: "Contrast", min: 0, max: 50, def: 25 },
      { key: "pattern", label: "Pattern Type", min: 0, max: 2, def: 0, options: ["Circle", "Dot", "Line"] },
    ],
    args: (v) => [v[0], v[1] / 50, r(v[2])],
  },
  {
    id: "basRelief", name: "Bas Relief", category: "Sketch",
    params: [
      { key: "detail", label: "Detail", min: 1, max: 15, def: 12 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 3 },
      { key: "light", label: "Light", min: 0, max: 7, def: 4, options: ["Top", "Top Right", "Right", "Bottom Right", "Bottom", "Bottom Left", "Left", "Top Left"] },
    ],
    args: (v) => [r(v[0]), r(v[1]), r(v[2])],
  },
  {
    id: "chrome", name: "Chrome", category: "Sketch",
    params: [
      { key: "detail", label: "Detail", min: 1, max: 10, def: 4 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 10, def: 7 },
    ],
    args: (v) => [r(v[0]), r(v[1])],
  },
  {
    id: "stamp", name: "Stamp", category: "Sketch",
    params: [
      { key: "balance", label: "Light/Dark Balance", min: 1, max: 50, def: 25 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 50, def: 5 },
    ],
    args: (v) => [v[0] / 50, v[1] / 50],
  },
  {
    id: "notePaper", name: "Note Paper", category: "Sketch",
    params: [
      { key: "balance", label: "Image Balance", min: 0, max: 50, def: 25 },
      { key: "graininess", label: "Graininess", min: 0, max: 20, def: 10 },
      { key: "relief", label: "Relief", min: 0, max: 25, def: 11 },
    ],
    args: (v) => [v[0] / 50, v[1] / 20, v[2] / 25],
  },
  {
    id: "tornEdges", name: "Torn Edges", category: "Sketch",
    params: [
      { key: "balance", label: "Image Balance", min: 0, max: 50, def: 25 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 8 },
      { key: "contrast", label: "Contrast", min: 0, max: 50, def: 25 },
    ],
    args: (v) => [v[0] / 50, v[1] / 15, v[2] / 50],
  },
  {
    id: "waterPaper", name: "Water Paper", category: "Sketch",
    params: [
      { key: "fiber", label: "Fiber Length", min: 1, max: 50, def: 15 },
      { key: "brightness", label: "Brightness", min: 0, max: 100, def: 50 },
      { key: "contrast", label: "Contrast", min: 0, max: 100, def: 50 },
    ],
    args: (v) => [v[0] / 50, v[1] / 100, v[2] / 100],
  },
  {
    id: "chalkCharcoal", name: "Chalk & Charcoal", category: "Sketch",
    params: [
      { key: "charcoal", label: "Charcoal Area", min: 0, max: 20, def: 6 },
      { key: "chalk", label: "Chalk Area", min: 0, max: 20, def: 6 },
      { key: "pressure", label: "Stroke Pressure", min: 0, max: 5, def: 5 },
    ],
    args: (v) => [v[0] / 20, v[1] / 20, v[2] / 5],
  },
  {
    id: "conteCrayon", name: "Conté Crayon", category: "Sketch",
    params: [
      { key: "foreground", label: "Foreground Level", min: 0, max: 20, def: 11 },
      { key: "background", label: "Background Level", min: 0, max: 20, def: 7 },
      { key: "texture", label: "Texture", min: 0, max: 3, def: 0, options: ["Canvas", "Sandstone", "Brick", "Burlap"] },
      { key: "scaling", label: "Scaling", min: 50, max: 200, def: 100, suffix: "%" },
      { key: "relief", label: "Relief", min: 0, max: 50, def: 10 },
      { key: "light", label: "Light", min: 0, max: 7, def: 0, options: ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"] },
    ],
    args: (v) => [v[0] / 20, v[1] / 20, r(v[2]), (v[3] - 50) / 150, v[4] / 50, r(v[5])],
  },
  {
    id: "reticulation", name: "Reticulation", category: "Sketch",
    params: [
      { key: "density", label: "Density", min: 0, max: 50, def: 25 },
      { key: "foreground", label: "Foreground Level", min: 0, max: 50, def: 25 },
      { key: "background", label: "Background Level", min: 0, max: 50, def: 25 },
    ],
    args: (v) => [v[0] / 50, v[1] / 50, v[2] / 50],
  },
  {
    id: "plaster", name: "Plaster", category: "Sketch",
    params: [
      { key: "balance", label: "Image Balance", min: 0, max: 50, def: 25 },
      { key: "smoothness", label: "Smoothness", min: 1, max: 15, def: 8 },
      { key: "light", label: "Light Direction", min: 0, max: 7, def: 0, options: ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"] },
    ],
    args: (v) => [v[0] / 50, v[1] / 15, r(v[2])],
  },

  // ── Stylize ──
  {
    id: "glowingEdges", name: "Glowing Edges", category: "Stylize",
    params: [
      { key: "width", label: "Edge Width", min: 1, max: 14, def: 2, suffix: "px" },
      { key: "brightness", label: "Edge Brightness", min: 1, max: 20, def: 6 },
    ],
    args: (v) => [r(v[0]), v[1]],
  },
  {
    id: "tiles", name: "Tiles", category: "Stylize",
    params: [
      { key: "num", label: "Number Of Tiles", min: 1, max: 99, def: 10 },
      { key: "offset", label: "Maximum Offset %", min: 0, max: 100, def: 10 },
      { key: "fill", label: "Fill Empty Area With", min: 0, max: 3, def: 0, options: ["Background", "Foreground", "Inverse", "Unaltered"] },
    ],
    args: (v) => [Math.max(1, r(v[0])), v[1], r(v[2])],
  },

  // ── Texture ──
  {
    id: "texturizer", name: "Texturizer", category: "Texture",
    params: [
      { key: "texture", label: "Texture", min: 0, max: 3, def: 0, options: ["Canvas", "Sandstone", "Brick", "Burlap"] },
      { key: "scaling", label: "Scaling", min: 50, max: 200, def: 100, suffix: "%" },
      { key: "relief", label: "Relief", min: 0, max: 50, def: 25 },
      { key: "light", label: "Light", min: 0, max: 7, def: 0, options: ["Top", "Top Left", "Left", "Bottom Left", "Bottom", "Bottom Right", "Right", "Top Right"] },
      { key: "invert", label: "Invert", min: 0, max: 1, def: 0, options: ["Off", "On"] },
    ],
    args: (v) => [r(v[0]), (v[1] - 50) / 150, v[2] / 50, r(v[3]), v[4] >= 0.5 ? 1 : 0],
  },
  {
    id: "mosaicTiles", name: "Mosaic Tiles", category: "Texture",
    params: [
      { key: "size", label: "Tile Size", min: 2, max: 64, def: 16 },
      { key: "grout", label: "Grout Width", min: 1, max: 15, def: 3 },
      { key: "lighten", label: "Lighten Grout", min: 0, max: 10, def: 9 },
    ],
    args: (v) => [r(v[0]), r(v[1]), v[2] / 10],
  },
  {
    id: "patchwork", name: "Patchwork", category: "Texture",
    params: [
      { key: "size", label: "Square Size", min: 2, max: 32, def: 8 },
      { key: "relief", label: "Relief", min: 0, max: 25, def: 8 },
    ],
    args: (v) => [r(v[0]), v[1] / 25],
  },
  {
    id: "craquelure", name: "Craquelure", category: "Texture",
    params: [
      { key: "spacing", label: "Crack Spacing", min: 2, max: 100, def: 40 },
      { key: "depth", label: "Crack Depth", min: 0, max: 10, def: 6 },
      { key: "brightness", label: "Crack Brightness", min: 0, max: 10, def: 8 },
    ],
    args: (v) => [r(v[0]), v[1] / 10, v[2] / 10],
  },
  {
    id: "grain", name: "Grain", category: "Texture",
    params: [
      { key: "intensity", label: "Intensity", min: 0, max: 100, def: 40 },
      { key: "contrast", label: "Contrast", min: 0, max: 100, def: 50 },
      { key: "type", label: "Grain Type", min: 0, max: 9, def: 0, options: ["Regular", "Soft", "Sprinkles", "Clumped", "Contrasty", "Enlarged", "Stippled", "Horizontal", "Vertical", "Speckle"] },
    ],
    args: (v) => [v[0] / 100, v[1] / 100, r(v[2])],
  },
  {
    id: "stainedGlass", name: "Stained Glass", category: "Texture",
    params: [
      { key: "cell", label: "Cell Size", min: 2, max: 64, def: 10 },
      { key: "border", label: "Border Thickness", min: 1, max: 16, def: 2 },
      { key: "light", label: "Light Intensity", min: 0, max: 10, def: 0 },
    ],
    args: (v) => [Math.max(2, r(v[0])), Math.max(1, r(v[1])), Math.max(0, v[2]) / 10],
  },

  // ── Pixelate ──
  {
    id: "colorHalftone", name: "Color Halftone", category: "Pixelate",
    params: [
      { key: "radius", label: "Max Radius", min: 1, max: 32, def: 8 },
      { key: "a1", label: "Channel 1 Angle", min: 0, max: 360, def: 108 },
      { key: "a2", label: "Channel 2 Angle", min: 0, max: 360, def: 162 },
      { key: "a3", label: "Channel 3 Angle", min: 0, max: 360, def: 90 },
    ],
    args: (v) => [Math.max(1, r(v[0])), r(v[1]), r(v[2]), r(v[3])],
  },
  {
    id: "crystallize", name: "Crystallize", category: "Pixelate",
    params: [{ key: "cell", label: "Cell Size", min: 2, max: 100, def: 10 }],
    args: (v) => [Math.max(2, r(v[0]))],
  },
  {
    id: "pointillize", name: "Pointillize", category: "Pixelate",
    params: [{ key: "cell", label: "Cell Size", min: 2, max: 100, def: 10 }],
    args: (v) => [Math.max(2, r(v[0]))],
  },
];

// id → def map for O(1) lookup.
const BY_ID = new Map(GALLERY_FILTERS.map((d) => [d.id, d]));

export function filterDef(id: string): GalleryFilterDef | undefined {
  return BY_ID.get(id);
}

export function filtersInCategory(cat: GalleryCategory): GalleryFilterDef[] {
  return GALLERY_FILTERS.filter((d) => d.category === cat);
}

/** Seeded UI values for a filter (its per-param defaults). */
export function defaultValues(def: GalleryFilterDef): number[] {
  return def.params.map((p) => p.def);
}

/** A fresh visible effect layer for `id`, seeded with the filter's defaults.
 *  Throws on an unknown id (a programming error). */
export function makeEffect(id: string): GalleryEffect {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown filter: ${id}`);
  return { id, values: defaultValues(def), visible: true };
}

// ── Pure stack operations (immutable: each returns a new array) ──

/** Append a new effect layer for `id` to the top of the stack. Unknown ids are
 *  ignored (returns the stack unchanged). */
export function addEffect(stack: GalleryEffect[], id: string): GalleryEffect[] {
  if (!BY_ID.has(id)) return stack;
  return [...stack, makeEffect(id)];
}

/** Photoshop's "New effect layer" button: duplicate the effect at `index`,
 *  inserting the copy directly above the original (so the pair applies twice in
 *  a row) with its own copy of the values. Out-of-range indices are ignored. */
export function duplicateEffect(stack: GalleryEffect[], index: number): GalleryEffect[] {
  if (index < 0 || index >= stack.length) return stack;
  const src = stack[index];
  return [
    ...stack.slice(0, index + 1),
    { ...src, values: [...src.values] },
    ...stack.slice(index + 1),
  ];
}

export function removeEffect(stack: GalleryEffect[], index: number): GalleryEffect[] {
  if (index < 0 || index >= stack.length) return stack;
  return stack.filter((_, i) => i !== index);
}

export function toggleEffect(stack: GalleryEffect[], index: number): GalleryEffect[] {
  if (index < 0 || index >= stack.length) return stack;
  return stack.map((e, i) => (i === index ? { ...e, visible: !e.visible } : e));
}

/** Move the effect at `index` by `dir` (−1 = earlier/up, +1 = later/down).
 *  Clamps at the ends (no wrap). */
export function moveEffect(stack: GalleryEffect[], index: number, dir: number): GalleryEffect[] {
  const to = index + dir;
  if (index < 0 || index >= stack.length || to < 0 || to >= stack.length) return stack;
  const next = [...stack];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

export function setEffectValues(stack: GalleryEffect[], index: number, values: number[]): GalleryEffect[] {
  if (index < 0 || index >= stack.length) return stack;
  return stack.map((e, i) => (i === index ? { ...e, values: [...values] } : e));
}

/** The effects that contribute to the composed result, in apply order
 *  (array order: index 0 is applied first, the last is applied last). */
export function composeOrder(stack: GalleryEffect[]): GalleryEffect[] {
  return stack.filter((e) => e.visible);
}

/** The engine-action arguments for one effect (UI values → engine units). */
export function effectArgs(effect: GalleryEffect): number[] {
  const def = BY_ID.get(effect.id);
  if (!def) throw new Error(`Unknown filter: ${effect.id}`);
  return def.args(effect.values);
}
