// Collapsed-dock rail glyphs (#479), one per panel in App.tsx's panel map. They
// reuse the shared icon set and tool glyphs; only histogram, channels,
// clone source (a stamp: the clone tool glyph is Layers') and paragraph, which
// nothing existing depicts, draw their own.
import { I } from "@monet-ui/monet-react";
import { TOOL_DEFS } from "../state/toolRail";

export const PANEL_ICONS = {
  layers: I.clone,
  color: I.dropper,
  adjustments: TOOL_DEFS.dodge.icon,
  properties: TOOL_DEFS.count.icon,
  history: TOOL_DEFS.rotateview.icon,
  actions: I.play,
  measurementlog: TOOL_DEFS.ruler.icon,
  info: TOOL_DEFS.colorsampler.icon,
  histogram: "M2.5 13.5h11M4.5 13.5V10M7 13.5V4.5M9.5 13.5V7M12 13.5V9",
  channels: "M8 2a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM5.5 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM10.5 6.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z",
  navigator: I.zoom,
  secondview: I.eye,
  animation: I.loop,
  notes: TOOL_DEFS.note.icon,
  swatches: TOOL_DEFS.slice.icon,
  libraries: I.link,
  brushes: I.brush,
  clonesource: "M6.5 2h3v3.5l2.5 2.5H4l2.5-2.5zM3 10h10v2.5H3zM4 14.5h8",
  styles: TOOL_DEFS.wand.icon,
  paths: I.pen,
  layercomps: TOOL_DEFS.artboard.icon,
  character: I.text,
  paragraph: "M3 4h10M3 7h10M3 10h10M3 13h6",
};
