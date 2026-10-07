// ─────────────────────────────────────────────────────────────
// Monet — component gallery catalog
// ─────────────────────────────────────────────────────────────
// The flat CATALOG the sandbox builds its menu bar + dockable panels from, so
// every implemented component is reachable from the top menus. Per-category
// demo files live in ./<category>.tsx (each exports a GalleryEntry[]); this
// index aggregates them all into one flat list.

import { chromeEntries } from "./chrome";
import { controlsEntries } from "./controls";
import { overlaysEntries } from "./overlays";
import { canvasEntries } from "./canvas";
import { colorEntries } from "./color";
import { layersEntries } from "./layers";
import { numericEntries } from "./numeric";
import { inspectorEntries } from "./inspector";
import { timelineEntries } from "./timeline";
import { curveEntries } from "./curve";
import { viewportEntries } from "./viewport";
import { metersEntries } from "./meters";
import { vectorEntries } from "./vector";
import type { GalleryEntry } from "./types";

export type { GalleryEntry } from "./types";

export const CATALOG: GalleryEntry[] = [
  ...chromeEntries,
  ...controlsEntries,
  ...overlaysEntries,
  ...canvasEntries,
  ...colorEntries,
  ...layersEntries,
  ...numericEntries,
  ...inspectorEntries,
  ...timelineEntries,
  ...curveEntries,
  ...viewportEntries,
  ...metersEntries,
  ...vectorEntries,
];
